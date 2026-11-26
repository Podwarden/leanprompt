// repeat-samples, before: one request per sample (LP-GE-01). The survey log is the same in every
// request, so each sample pays to prefill it again; the samples differ only in what is generated.

import { answerText, chatRequest } from "../../common.js";
import type { AppOptions, ExampleApp } from "../../types.js";
import { check } from "../check.js";
import { SAMPLES, SYSTEM, TEMPERATURE } from "../data.js";
import { scenario } from "../scenario.js";

/** The most common answer, ignoring case and surrounding space. */
const vote = (texts: string[]): string => {
  const n = new Map<string, number>();
  for (const t of texts) n.set(t.trim().toLowerCase(), (n.get(t.trim().toLowerCase()) ?? 0) + 1);
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return texts.find((t) => t.trim().toLowerCase() === best) ?? "";
};

export function makeApp(opts: AppOptions = {}): ExampleApp {
  const dialect = opts.dialect ?? "openai.chat";
  const build = (input: string) =>
    chatRequest(dialect, { system: SYSTEM, messages: [{ role: "user", text: input }], maxTokens: 40, extra: { temperature: TEMPERATURE } });
  return {
    name: "repeat-samples",
    dialect,
    scenario,
    check,
    buildRequest: (input) => build(input),
    async run(client, sc) {
      const answers: string[] = [];
      for (let session = 0; session < sc.sessions; session++) {
        for (const t of sc.turns) {
          const samples: string[] = [];
          for (let k = 0; k < SAMPLES; k++) samples.push(answerText((await client.send(build(t.input))).body));
          answers.push(vote(samples));
        }
      }
      return answers;
    },
  };
}
