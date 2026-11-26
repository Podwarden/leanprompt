// timeout-retry, before: a 2 s timeout on answers of up to ~2,000 tokens, retried on any error
// (LP-GE-04, LP-GE-05). The server keeps generating each abandoned attempt, and the retry
// pays for the prompt and the answer again.

import { answerText, chatRequest } from "../../common.js";
import type { AppOptions, ExampleApp } from "../../types.js";
import { check } from "../check.js";
import { isLong, MAX_TOKENS, SYSTEM } from "../data.js";
import { scenario } from "../scenario.js";

const TIMEOUT_MS = 2_000;
const MAX_ATTEMPTS = 3;

export function makeApp(opts: AppOptions = {}): ExampleApp {
  const dialect = opts.dialect ?? "openai.chat";
  const build = (input: string) => chatRequest(dialect, { system: SYSTEM, messages: [{ role: "user", text: input }], maxTokens: MAX_TOKENS });
  return {
    name: "timeout-retry",
    dialect,
    scenario,
    check,
    // Offline runs: 20 ms per token, so a 2,000-token answer takes 40 s and a one-line answer 0.4 s.
    sim: { msPerOutputToken: 20, outputTokens: (input) => (isLong(input) ? 2000 : 20) },
    buildRequest: (input) => build(input),
    async run(client, sc) {
      const answers: string[] = [];
      for (let session = 0; session < sc.sessions; session++) {
        for (const t of sc.turns) {
          let text = "";
          for (let attempt = 1; attempt <= MAX_ATTEMPTS && text === ""; attempt++) {
            try {
              text = answerText((await client.send({ ...build(t.input), timeoutMs: TIMEOUT_MS })).body);
            } catch {
              // try again
            }
          }
          answers.push(text);
        }
      }
      return answers;
    },
  };
}
