// dated-chat, after: the time goes in a labelled block in the newest user message (LP-PC-03).
// The system prompt is the same on every call, so the provider can reuse it.

import { answerText, chatRequest, stepClock } from "../../common.js";
import type { ExampleApp, AppOptions } from "../../types.js";
import { check } from "../check.js";
import { HANDBOOK } from "../data.js";
import { scenario } from "../scenario.js";

const systemPrompt = (_now: Date): string => `You are a support assistant for a home-goods shop.\n${HANDBOOK}`;
const userText = (text: string, now: Date): string =>
  `<environment>\nCurrent time: ${now.toISOString().slice(0, 19)}Z\n</environment>\n\n${text}`;

export function makeApp(opts: AppOptions = {}): ExampleApp {
  const dialect = opts.dialect ?? "openai.chat";
  const clock = opts.clock ?? stepClock();
  return {
    name: "dated-chat",
    dialect,
    scenario,
    check,
    buildRequest: (input, ctx) =>
      chatRequest(dialect, { system: systemPrompt(ctx.now), messages: [{ role: "user", text: userText(input, ctx.now) }] }),
    async run(client, sc) {
      const answers: string[] = [];
      for (let session = 0; session < sc.sessions; session++) {
        const messages: { role: "user" | "assistant"; text: string }[] = [];
        for (const [turn, t] of sc.turns.entries()) {
          const now = clock();
          messages.push({ role: "user", text: userText(turn === 0 ? `Ticket ${1000 + session}. ${t.input}` : t.input, now) });
          const req = chatRequest(dialect, { system: systemPrompt(now), messages });
          const text = answerText((await client.send(req)).body);
          messages.push({ role: "assistant", text });
          answers.push(text);
        }
      }
      return answers;
    },
  };
}
