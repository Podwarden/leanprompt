// rag-chunks-first, after: the system prompt is the shared instructions and nothing else; the
// retrieved chunks go in a labelled block at the top of the user message (LP-PC-07).
// The system prompt is the same on every call, so the provider can reuse it.

import { answerText, chatRequest } from "../../common.js";
import type { AppOptions, ExampleApp } from "../../types.js";
import { check } from "../check.js";
import { GUIDELINES, render, retrieveFor, type Chunk } from "../data.js";
import { scenario } from "../scenario.js";

const systemPrompt = (_chunks: Chunk[]): string =>
  `You are a parts-support assistant. Answer only from the chunks in the <retrieved> block of the user message and cite the id of the chunk you used.\n${GUIDELINES}`;
const userText = (text: string, chunks: Chunk[]): string => `<retrieved>\n${render(chunks)}\n</retrieved>\n\n${text}`;

export function makeApp(opts: AppOptions = {}): ExampleApp {
  const dialect = opts.dialect ?? "openai.chat";
  const build = (messages: { role: "user" | "assistant"; text: string }[], chunks: Chunk[]) =>
    chatRequest(dialect, { system: systemPrompt(chunks), messages });
  return {
    name: "rag-chunks-first",
    dialect,
    scenario,
    check,
    buildRequest: (input, ctx) => build([{ role: "user", text: userText(input, retrieveFor(input, ctx.session)) }], retrieveFor(input, ctx.session)),
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
