// compaction-rewrite, before: compaction writes the summary into the system prompt and asks for it
// with a separate summariser prompt (LP-PC-08). The head changes at every compaction, and the
// summarising call reads the whole history again at full price.

import { answerText, chatRequest } from "../../common.js";
import type { AppOptions, ExampleApp } from "../../types.js";
import { check } from "../check.js";
import { BASE, COMPACT_AFTER, SUMMARISE, TOOLS } from "../data.js";
import { scenario } from "../scenario.js";

type Msg = { role: "user" | "assistant"; text: string };

export function makeApp(opts: AppOptions = {}): ExampleApp {
  const dialect = opts.dialect ?? "openai.chat";
  return {
    name: "compaction-rewrite",
    dialect,
    scenario,
    check,
    buildRequest: (input) => chatRequest(dialect, { system: BASE, tools: TOOLS, messages: [{ role: "user", text: input }] }),
    async run(client, sc) {
      const answers: string[] = [];
      for (let session = 0; session < sc.sessions; session++) {
        let system = BASE;
        let messages: Msg[] = [];
        for (const [turn, t] of sc.turns.entries()) {
          messages.push({ role: "user", text: turn === 0 ? `Ticket ${1000 + session}. ${t.input}` : t.input });
          const text = answerText((await client.send(chatRequest(dialect, { system, tools: TOOLS, messages }))).body);
          messages.push({ role: "assistant", text });
          answers.push(text);
          if (turn + 1 === COMPACT_AFTER) {
            const ask: Msg = { role: "user", text: SUMMARISE };
            const summary = answerText((await client.send(chatRequest(dialect, { system: "You are a summariser.", messages: [...messages, ask] }))).body);
            system = `${BASE}\n\nSummary of the conversation so far:\n${summary}`;
            messages = [];
          }
        }
      }
      return answers;
    },
  };
}
