// dict-tools-agent, before: the tool list comes out of an object filled in whatever order the
// tools registered, and each schema keeps its own key order (LP-PC-04). It differs per session.

import { answerText, chatRequest, rng, type ToolDef } from "../../common.js";
import type { AppOptions, ExampleApp } from "../../types.js";
import { check } from "../check.js";
import { register, SYSTEM } from "../data.js";
import { scenario } from "../scenario.js";

const toolList = (registry: Record<string, ToolDef>): ToolDef[] => Object.values(registry);

export function makeApp(opts: AppOptions = {}): ExampleApp {
  const dialect = opts.dialect ?? "openai.chat";
  let sessions = 0; // a new process or session registers the tools in a new order
  const newTools = (): ToolDef[] => toolList(register(rng((opts.seed ?? 1) + sessions++)));
  return {
    name: "dict-tools-agent",
    dialect,
    scenario,
    check,
    buildRequest: (input, ctx) =>
      chatRequest(dialect, { system: SYSTEM, tools: toolList(register(rng((opts.seed ?? 1) + ctx.session))), messages: [{ role: "user", text: input }] }),
    async run(client, sc) {
      const answers: string[] = [];
      for (let session = 0; session < sc.sessions; session++) {
        const tools = newTools(); // built once, at the start of the session
        const messages: { role: "user" | "assistant"; text: string }[] = [];
        for (const [turn, t] of sc.turns.entries()) {
          messages.push({ role: "user", text: turn === 0 ? `Ticket ${1000 + session}. ${t.input}` : t.input });
          const text = answerText((await client.send(chatRequest(dialect, { system: SYSTEM, tools, messages }))).body);
          messages.push({ role: "assistant", text });
          answers.push(text);
        }
      }
      return answers;
    },
  };
}
