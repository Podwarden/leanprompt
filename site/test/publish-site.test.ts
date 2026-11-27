import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CACHE_IMMUTABLE,
  CACHE_MANIFEST,
  amzDateOf,
  buildManifest,
  contentTypeOf,
  listFiles,
  parseArgs,
  s3Config,
  s3Request,
  sha256Hex,
  signV4,
  signingKey,
  uploadPlan,
  uriEncode,
} from "../../scripts/publish-site.mjs";

const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

// AWS's published Signature Version 4 examples: the SigV4 test suite (get-vanilla), the IAM
// "examples of the complete Signature Version 4 signing process", and the S3 "Authenticating
// requests: using the Authorization header" examples.
describe("SigV4 against AWS's published test vectors", () => {
  const suite = { accessKey: "AKIDEXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

  it("derives the signing key (IAM example)", () => {
    expect(signingKey(suite.secretKey, "20150830", "us-east-1", "iam").toString("hex")).toBe("c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9");
  });

  it("get-vanilla", () => {
    const s = signV4({ method: "GET", path: "/", headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" }, payloadHash: EMPTY, ...suite, region: "us-east-1", service: "service", doubleEncode: true });
    expect(s.canonicalRequest).toBe(["GET", "/", "", "host:example.amazonaws.com", "x-amz-date:20150830T123600Z", "", "host;x-amz-date", EMPTY].join("\n"));
    expect(s.signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
    expect(s.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  });

  it("IAM ListUsers (query string and content-type)", () => {
    const s = signV4({
      method: "GET",
      path: "/",
      query: [["Version", "2010-05-08"], ["Action", "ListUsers"]],
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8", Host: "iam.amazonaws.com", "X-Amz-Date": "20150830T123600Z" },
      payloadHash: EMPTY,
      ...suite,
      region: "us-east-1",
      service: "iam",
      doubleEncode: true,
    });
    expect(s.canonicalRequest.split("\n")[2]).toBe("Action=ListUsers&Version=2010-05-08");
    expect(sha256Hex(s.canonicalRequest)).toBe("f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59");
    expect(s.signature).toBe("5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
  });

  const s3 = { accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "s3" };

  it("S3 GET object", () => {
    const s = signV4({
      method: "GET",
      path: "/test.txt",
      headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9", "x-amz-content-sha256": EMPTY, "x-amz-date": "20130524T000000Z" },
      payloadHash: EMPTY,
      ...s3,
    });
    expect(s.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("S3 PUT object (a path that needs encoding, a payload hash)", () => {
    const body = "Welcome to Amazon S3.";
    const hash = sha256Hex(body);
    expect(hash).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    const s = signV4({
      method: "PUT",
      path: "/test$file.text",
      headers: { Host: "examplebucket.s3.amazonaws.com", Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-date": "20130524T000000Z", "x-amz-storage-class": "REDUCED_REDUNDANCY", "x-amz-content-sha256": hash },
      payloadHash: hash,
      ...s3,
    });
    expect(s.canonicalRequest.split("\n")[1]).toBe("/test%24file.text");
    expect(s.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("encodes like SigV4", () => {
    expect(uriEncode("a b/c~d_e.f-g", true)).toBe("a%20b/c~d_e.f-g");
    expect(uriEncode("a/b", false)).toBe("a%2Fb");
    expect(uriEncode("é", false)).toBe("%C3%A9");
    expect(amzDateOf(new Date("2026-11-27T12:34:56.789Z"))).toBe("20261127T123456Z");
  });
});

describe("the S3 request", () => {
  const cfg = s3Config({ S3_ENDPOINT: "https://media.example.com", S3_BUCKET: "example-bucket", S3_ACCESS_KEY: "AKTEST", S3_SECRET_KEY: "s3cr3t-never-shown" });

  it("reads the environment, with defaults", () => {
    expect(cfg).toMatchObject({ endpoint: "https://media.example.com", host: "media.example.com", bucket: "example-bucket", prefix: "leanprompt-site", region: "us-east-1" });
    expect(() => s3Config({})).toThrow(/S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY/);
    expect(() => s3Config({ S3_ENDPOINT: "http://media.example.com", S3_BUCKET: "b-1", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "s3cr3t" })).toThrow(/https/);
    expect(() => s3Config({ S3_ENDPOINT: "https://media.example.com", S3_BUCKET: "b-1", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "s3cr3t", S3_PREFIX: "../x" })).toThrow(/S3_PREFIX/);
    try {
      s3Config({ S3_ENDPOINT: "ftp://x", S3_BUCKET: "b-1", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "s3cr3t" });
    } catch (err) {
      expect(String(err)).not.toContain("s3cr3t");
    }
  });

  it("signs a path-style PUT the server can verify, and sends the headers it was given", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const body = Buffer.from("<!doctype html>hi");
    const r = await s3Request(cfg, "PUT", `leanprompt-site/${COMMIT}/index.html`, { body, headers: { "content-type": "text/html; charset=utf-8", "cache-control": CACHE_IMMUTABLE }, fetchImpl: fake });
    expect(r.status).toBe(200);
    expect(seen!.url).toBe(`https://media.example.com/example-bucket/leanprompt-site/${COMMIT}/index.html`);
    const h = seen!.init.headers as Record<string, string>;
    expect(h["content-type"]).toBe("text/html; charset=utf-8");
    expect(h["cache-control"]).toBe(CACHE_IMMUTABLE);
    expect(h["x-amz-content-sha256"]).toBe(sha256Hex(body));
    expect(JSON.stringify(seen)).not.toContain("s3cr3t-never-shown");
    // What the server computes from the request it received.
    const again = signV4({
      method: "PUT",
      path: `/example-bucket/leanprompt-site/${COMMIT}/index.html`,
      headers: { host: "media.example.com", "x-amz-date": h["x-amz-date"]!, "x-amz-content-sha256": h["x-amz-content-sha256"]!, "content-type": h["content-type"]!, "cache-control": h["cache-control"]! },
      payloadHash: h["x-amz-content-sha256"]!,
      accessKey: "AKTEST",
      secretKey: "s3cr3t-never-shown",
      region: "us-east-1",
      service: "s3",
    });
    expect(h.authorization).toBe(again.authorization);
    expect(h.authorization).toContain("SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date");
  });
});

describe("the manifest", () => {
  function site(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "lp-pub-"));
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
    return dir;
  }
  const make = (dir: string) => buildManifest({ paths: listFiles(dir), read: (p) => readFileSync(join(dir, p)), commit: COMMIT, version: "0.1.0", published: "2026-11-27T00:00:00.000Z" });

  it("lists every file with its sha256", () => {
    const dir = site({ "index.html": "home", "assets/site.css": "body{}", "rules/lp-pc-02/index.html": "rule", "assets/fonts/x.woff2": "font" });
    expect(listFiles(dir)).toEqual(["assets/fonts/x.woff2", "assets/site.css", "index.html", "rules/lp-pc-02/index.html"]);
    const m = make(dir);
    expect(m).toEqual({
      commit: COMMIT,
      version: "0.1.0",
      published: "2026-11-27T00:00:00.000Z",
      files: { "assets/fonts/x.woff2": sha256Hex("font"), "assets/site.css": sha256Hex("body{}"), "index.html": sha256Hex("home"), "rules/lp-pc-02/index.html": sha256Hex("rule") },
    });
  });

  it("refuses what lmwarden.com would not serve", () => {
    expect(() => make(site({ "index.html": "x", "favicon.ico": "x" }))).toThrow(/favicon.ico: a file type/);
    expect(() => make(site({ "index.html": "x", ".well-known/a.txt": "x" }))).toThrow(/a path the server does not accept/);
    expect(() => make(site({ "about.html": "x" }))).toThrow(/no index.html/);
    expect(() => buildManifest({ paths: ["index.html"], read: () => "x", commit: "abc", version: "1", published: "" })).toThrow(/full commit/);
  });

  it("uploads the files first and current.json last, with their caching", () => {
    const m = make(site({ "index.html": "home", "assets/site.js": "1" }));
    const plan = uploadPlan("leanprompt-site", m);
    expect(plan.map((i) => i.key)).toEqual([
      `leanprompt-site/${COMMIT}/assets/site.js`,
      `leanprompt-site/${COMMIT}/index.html`,
      `leanprompt-site/manifests/${COMMIT}.json`,
      "leanprompt-site/current.json",
    ]);
    expect(plan[0]).toMatchObject({ contentType: "text/javascript; charset=utf-8", cacheControl: CACHE_IMMUTABLE });
    expect(plan.at(-1)).toMatchObject({ contentType: "application/json", cacheControl: CACHE_MANIFEST });
    expect(CACHE_IMMUTABLE).toBe("public, max-age=31536000, immutable");
    expect(CACHE_MANIFEST).toBe("no-cache");
  });

  it("maps content types by extension", () => {
    expect(contentTypeOf("a/b.HTML")).toBe("text/html; charset=utf-8");
    expect(contentTypeOf("og.jpg")).toBe("image/jpeg");
    expect(contentTypeOf("README")).toBeUndefined();
    expect(contentTypeOf(".css")).toBeUndefined();
  });
});

describe("the options", () => {
  it("parses", () => {
    expect(parseArgs([])).toMatchObject({ dryRun: false, allowUnpublished: false });
    expect(parseArgs(["--dry-run", "--ref", "abc"])).toMatchObject({ dryRun: true, ref: "abc" });
    expect(parseArgs(["--rollback", COMMIT])).toMatchObject({ rollback: COMMIT });
    expect(() => parseArgs(["--rollback"])).toThrow(/needs a commit/);
    expect(() => parseArgs(["--rollback", COMMIT, "--allow-unpublished"])).toThrow();
    expect(() => parseArgs(["--force"])).toThrow(/unknown option/);
  });
});
