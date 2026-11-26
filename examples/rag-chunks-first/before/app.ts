// rag-chunks-first, before: the retrieved chunks open the system prompt, ahead of the shared
// instructions (LP-PC-07). Every question retrieves different chunks, so the long shared part
// that follows them is never at the same place twice and the provider can reuse none of it.

import { answerText, chatRequest } from "../../common.js";
import type { AppOptions, ExampleApp } from "../../types.js";
import { check } from "../check.js";
import { GUIDELINES, render, retrieveFor, type Chunk } from "../data.js";
import { scenario } from "../scenario.js";

const systemPrompt = (chunks: Chunk[]): string =>
  `Retrieved chunks for this question:\n${render(chunks)}\n\n` +
  `You are a parts-support assistant. Answer only from the chunks at the top of this prompt and cite the id of the chunk you used.\n${GUIDELINES}`;
const userText = (text: string, _chunks: Chunk[]): string => text;

export function makeApp(opts: AppOptions = {}): ExampleApp {
  const dialect = opts.dialect ?? "openai.chat";
  const build = (messages: { role: "user" | "assistant"; text: string }[], chunks: Chunk[]) =>
    chatRequest(dialect, { system: systemPrompt(chunks), messages });
  return {
    name: "rag-chunks-first",
    dialect,
    scenario,
    check,
    buildRequest: (input, ctx) => build([{ role: "user", text: input }], retrieveFor(input, ctx.session)),
    async run(client, sc) {
      const answers: string[] = [];
      for (let session = 0; session < sc.sessions; session++) {
        const messages: { role: "user" | "assistant"; text: string }[] = [];
        for (const [turn, t] of sc.turns.entries()) {
          const chunks = retrieveFor(t.input, session);
          messages.push({ role: "user", text: userText(turn === 0 ? `Ticket ${1000 + session}. ${t.input}` : t.input, chunks) });
          const text = answerText((await client.send(build(messages, chunks))).body);
          messages.push({ role: "assistant", text });
          answers.push(text);
        }
      }
      return answers;
    },
  };
}
