// timeout-retry, after: a timeout sized to the generation time, and a bounded retry with backoff
// only for errors a retry can fix (LP-GE-04, LP-GE-05). Streaming with an idle timeout is the
// preferred fix for long answers; this example stays non-streaming on purpose, so it uses the
// rule's alternative: a total timeout above the expected generation time.

import { answerText, chatRequest } from "../../common.js";
import type { AppOptions, ExampleApp } from "../../types.js";
import { check } from "../check.js";
import { isLong, MAX_TOKENS, SYSTEM } from "../data.js";
import { scenario } from "../scenario.js";

const SLOWEST_MS_PER_TOKEN = 50; // the slowest decode rate seen on this route
const TIMEOUT_MS = Math.ceil(MAX_TOKENS * SLOWEST_MS_PER_TOKEN * 1.2);
const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set([408, 409, 429, 500, 503, 504, 529]);
const MAX_BACKOFF_MS = 30_000;

/** The HTTP status of a failed call, from `status` or from a message such as "HTTP 429". */
const statusOf = (e: unknown): number => Number((e as { status?: number }).status ?? /HTTP (\d{3})/.exec(String((e as Error)?.message))?.[1]);

/** A 429 caused by an exhausted quota or credit keeps failing until access resumes: stop. */
const isQuota = (e: unknown): boolean => {
  const { type, code } = e as { type?: string; code?: string };
  return /quota|credit|billing/i.test(`${type ?? ""} ${code ?? ""} ${(e as Error)?.message ?? ""}`);
};

/** Honours a `Retry-After` the error carries (seconds, as `retryAfter`); otherwise backs off exponentially. */
const delayMs = (e: unknown, attempt: number): number =>
  Math.min(((e as { retryAfter?: number }).retryAfter ?? 2 ** (attempt - 1)) * 1000, MAX_BACKOFF_MS);

export function makeApp(opts: AppOptions = {}): ExampleApp {
  const dialect = opts.dialect ?? "openai.chat";
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
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
            } catch (e) {
              if (!RETRYABLE.has(statusOf(e)) || isQuota(e)) break; // a timeout, a 400 or a spent quota would only repeat
              if (attempt < MAX_ATTEMPTS) await sleep(delayMs(e, attempt));
            }
          }
          answers.push(text);
        }
      }
      return answers;
    },
  };
}
