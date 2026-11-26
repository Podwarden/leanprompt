// repeat-samples, after: one request that asks for all the samples with `n` (LP-GE-01).
// The log is prefilled once and the samples are decoded from that prefill. Where `n` is not
// available the samples are sent one after another, so the later ones can read the cache.

import { answerText, answerTexts, chatRequest } from "../../common.js";
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
  const build = (input: string, n?: number) =>
    chatRequest(dialect, { system: SYSTEM, messages: [{ role: "user", text: input }], maxTokens: 40, extra: { temperature: TEMPERATURE, ...(n ? { n } : {}) } });
  return {
    name: "repeat-samples",
    dialect,
    scenario,
    check,
    buildRequest: (input) => build(input, dialect === "openai.chat" ? SAMPLES : undefined),
    async run(client, sc) {
      const answers: string[] = [];
      let nSupported = dialect === "openai.chat"; // Anthropic has no `n`; a model that rejects it answers 400
      for (let session = 0; session < sc.sessions; session++) {
        for (const t of sc.turns) {
          let samples: string[] = [];
          if (nSupported) {
            try {
              samples = answerTexts((await client.send(build(t.input, SAMPLES))).body);
            } catch (e) {
              if ((e as { status?: number }).status !== 400) throw e;
              nSupported = false;
            }
          }
          for (let k = 0; !nSupported && k < SAMPLES; k++) samples.push(answerText((await client.send(build(t.input))).body));
          answers.push(vote(samples));
        }
      }
      return answers;
    },
  };
}
