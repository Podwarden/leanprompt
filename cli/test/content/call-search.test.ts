import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SHAPES = readFileSync(join(ROOT, "skills", "llm-call-audit", "call-shapes.md"), "utf8");
const SKILL = readFileSync(join(ROOT, "skills", "llm-call-audit", "SKILL.md"), "utf8");

/** The `rg` commands of call-shapes.md, as [pattern, glob-for-language] pairs. The test reads the documented patterns, so the doc and the test cannot drift. */
function documented(): { pattern: RegExp; globs: string }[] {
  const out: { pattern: RegExp; globs: string }[] = [];
  for (const line of SHAPES.split("\n")) {
    const m = /^rg -n (?:-U )?'([^']+)'(.*)$/.exec(line);
    if (!m) continue;
    let src = m[1]!.replaceAll("\\x27", "'");
    const dotAll = src.startsWith("(?s)");
    if (dotAll) src = src.slice(4);
    out.push({ pattern: new RegExp(src, dotAll ? "s" : ""), globs: m[2]! });
  }
  return out;
}

const search = (kind: "path" | "ts" | "py" | "go") => {
  const all = documented();
  const pick = kind === "path" ? all.filter((d) => !d.globs.includes("-g '*.")) : all.filter((d) => d.globs.includes(`'*.${kind === "ts" ? "{ts" : kind}`));
  expect(pick.length, kind).toBeGreaterThan(0);
  return (code: string) => pick.some((d) => d.pattern.test(code));
};

const PATH_FIXTURES: Record<string, string> = {
  "template literal on a /v1 base": "const res = await fetch(`${base}/chat/completions`, { method: 'POST' });",
  "template literal, messages endpoint": "await fetch(`${BASE_URL}/messages`, init)",
  "TS concatenation": 'const url = base + "/chat/completions";',
  "TS concatenation, responses": "const url = base + '/responses';",
  "Python f-string": 'r = requests.post(f"{base}/chat/completions", json=body)',
  "Python urljoin": 'url = urljoin(base, "chat/completions")',
  "Go Sprintf": 'url := fmt.Sprintf("%s/chat/completions", base)',
  "the old literal form": 'fetch("https://api.example.com/v1/chat/completions", {})',
  "the old literal, messages": 'curl("https://api.anthropic.com/v1/messages")',
  "Gemini native": "POST /models/x:generateContent",
  "batch endpoint": 'const url = base + "/messages/batches";',
  "a doc comment (a hit the skill says to confirm)": "// posts to /v1/chat/completions",
};

describe("call-shapes.md raw-HTTP search", () => {
  it("documents a path search and a body search for TS/JS, Python and Go", () => {
    for (const k of ["path", "ts", "py", "go"] as const) search(k);
  });

  for (const [name, code] of Object.entries(PATH_FIXTURES)) {
    it(`the path pattern matches: ${name}`, () => {
      expect(search("path")(code)).toBe(true);
    });
  }

  it("the path pattern leaves ordinary lines alone", () => {
    for (const code of ["const x = compute(1);", "import { createLogger } from 'leanprompt/log';", 'router.get("/health")'])
      expect(search("path")(code), code).toBe(false);
  });

  it("the body pattern matches a messages array near fetch, axios and got (URL in a variable)", () => {
    const ts = search("ts");
    expect(ts("const r = await fetch(url, {\n  method: 'POST',\n  body: JSON.stringify({ model, messages: [{ role: 'user', content: q }] }),\n});")).toBe(true);
    expect(ts('await axios.post(endpoint, { model: "m", "messages": history });')).toBe(true);
    expect(ts("await got.post(u, { json: { model, messages } })")).toBe(true);
    expect(ts("const r = await fetch(url);\nconst n = 3;")).toBe(false);
  });

  it("the body pattern matches a messages list near requests, httpx and net/http", () => {
    const py = search("py");
    expect(py('resp = requests.post(url, json={"model": m, "messages": msgs})')).toBe(true);
    expect(py('async with httpx.AsyncClient() as c:\n    r = await c.post(u)\nclient.post(u, json={\n  "model": m,\n  "messages": msgs})')).toBe(true);
    expect(py("requests.get(url)\nx = 1")).toBe(false);
    expect(search("go")('req, _ := http.NewRequest("POST", url, bytes.NewBufferString(`{"model":"m","messages":[]}`))\nvar _ = "messages"')).toBe(true);
  });

  it("tells the assistant to confirm a hit is a real call, in the skill and in the search page", () => {
    expect(SHAPES).toMatch(/A hit is a candidate, not a call/);
    expect(SKILL).toMatch(/confirm it is a request the app really sends/);
    expect(SKILL).toContain("chat/completions");
  });
});
