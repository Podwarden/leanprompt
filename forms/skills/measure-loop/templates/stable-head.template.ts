// The helper for a CI test that fails when the stable head of your requests changes.
// Install: npm i -D @kvsig/core@0.1.0 (kvsig/1 and loose/1 ids; never assert on loose/2).
// Copy this file into your tests under a name of your own (for example test/stable-head.ts) and
// write the test beside it (for example test/stable-head.test.ts, any runner):
//
//   import { assertStableHead } from "./stable-head";
//   it("the head does not change from one day to the next", () =>
//     assertStableHead(build, ["2026-11-01", "2026-11-02"], { sys: true, tools: true }));
//
// `build` is the function your app uses to build a request, returning { dialect, body }, and the
// inputs are two values that must NOT change the head (two dates, two users, two working directories).
import { canonicalize, ids, TEST_KEY, type Dialect } from "@kvsig/core";

export type Built = { dialect: Dialect; body: unknown };
export type Expect = { sys?: true; tools?: true; nodesUpTo?: number };

const idsOf = (b: Built) => {
  const canon = canonicalize(b.body as never, b.dialect);
  if (canon === null) throw new Error(`kvsig could not identify the request (dialect ${b.dialect}); is it a supported dialect, under 2 MiB, valid JSON?`);
  return ids(canon, TEST_KEY);
};

export function assertStableHead<T>(build: (input: T) => Built, inputs: [T, T], expect: Expect): void {
  const [a, b] = [idsOf(build(inputs[0])), idsOf(build(inputs[1]))];
  const bad: string[] = [];
  if (expect.sys && a.sys !== b.sys)
    bad.push(a.loose_sys === b.loose_sys
      ? "`sys` differs, `loose_sys` equal: the system prompt changed only in noise (a date line, a reminder, whitespace)"
      : "`sys` differs, `loose_sys` differs: the system prompt changed in content the loose form does not treat as noise (a labelled date or time, an id, a path, wording)");
  if (expect.tools && a.tools !== b.tools)
    bad.push(a.loose_tools === b.loose_tools
      ? "`tools` differs, `loose_tools` equal: the tool list changed only in the member order inside a schema or arguments"
      : "`tools` differs, `loose_tools` differs: a tool was added, removed, edited or reordered");
  for (let i = 0; i < (expect.nodesUpTo ?? 0); i++)
    if (a.nodes[i] !== b.nodes[i]) { bad.push(`\`nodes[${i}]\` differs: the prompt up to message ${i} changed (a history message was rewritten, or the head above changed)`); break; }
  if (bad.length) throw new Error(`The stable head changed between the two inputs:\n- ${bad.join("\n- ")}`);
}
// leanprompt:generated v0.1.0-dev.7 — managed by npx leanprompt init; local edits are replaced on update
