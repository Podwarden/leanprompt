import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A small deterministic unified diff, so the README diff blocks and the test that checks them
 * do not depend on which diff(1) (GNU, BSD) is installed. Line-based LCS, `context` lines of
 * context (default 1, like `diff -U1`), hunks merged when their context touches.
 */
export function unifiedDiff(a: string, b: string, aName: string, bName: string, context = 1): string {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x[x.length - 1] === "") x.pop();
  if (y[y.length - 1] === "") y.pop();
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  // Edit script: " " keep, "-" delete, "+" insert. Deletes before inserts on ties.
  const ops: { t: " " | "-" | "+"; s: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) ops.push({ t: " ", s: x[i++] }), j++;
    else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push({ t: "-", s: x[i++] });
    else ops.push({ t: "+", s: y[j++] });
  }

  const changed = ops.map((o, k) => (o.t === " " ? -1 : k)).filter((k) => k >= 0);
  if (changed.length === 0) return "";
  const ranges: [number, number][] = [];
  for (const k of changed) {
    const lo = Math.max(0, k - context);
    const hi = Math.min(ops.length, k + context + 1);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }

  const out = [`--- ${aName}`, `+++ ${bName}`];
  for (const [lo, hi] of ranges) {
    const before = ops.slice(0, lo);
    const slice = ops.slice(lo, hi);
    const aStart = before.filter((o) => o.t !== "+").length + 1;
    const bStart = before.filter((o) => o.t !== "-").length + 1;
    const aLen = slice.filter((o) => o.t !== "+").length;
    const bLen = slice.filter((o) => o.t !== "-").length;
    const rng = (start: number, len: number): string => (len === 1 ? `${start}` : `${len === 0 ? start - 1 : start},${len}`);
    out.push(`@@ -${rng(aStart, aLen)} +${rng(bStart, bLen)} @@`);
    for (const o of slice) out.push(o.t + o.s);
  }
  return out.join("\n") + "\n";
}

/** The diff block for an example app: before/app.ts against after/app.ts. */
export function exampleDiff(dir: string): string {
  const read = (form: string): string => readFileSync(join(dir, form, "app.ts"), "utf8").replace(/\r\n/g, "\n");
  return unifiedDiff(read("before"), read("after"), "before/app.ts", "after/app.ts");
}
