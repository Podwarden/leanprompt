# timeout-retry

Rule: [LP-GE-04](../../skills/generation-economy/rules/LP-GE-04.md) and [LP-GE-05](../../skills/generation-economy/rules/LP-GE-05.md), "Stream long outputs; timeouts that match generation time".

A release-notes writer alternates a long answer (forty numbered items, about 2,000 tokens) with a one-line answer. Four sessions of eight requests.

**Before.** The client times out after 2 seconds and retries up to three times on any error. A 2,000-token answer takes far longer than 2 seconds, so each attempt is abandoned while the server keeps generating it, and the next attempt pays for the prompt and the answer again. The app never receives the long answer. One-line answers finish in time and are unaffected.

**After.** The timeout is computed from the output limit and the slowest decode rate seen on the route. A failed call is retried only for the statuses LP-GE-05 lists (408, 409, 429, 500, 503, 504, 529), at most three attempts in all, with exponential backoff that honours a `Retry-After` the error carries (capped at 30 seconds). A timeout, a 400, or a 429 that reports an exhausted quota or credit is not retried. The wait is an injectable `sleep`, so tests and the simulator pass a no-op.

Streaming with an idle timeout is the preferred fix in LP-GE-04 for long answers. This example stays non-streaming on purpose: the harness's `LlmClient` has no streaming call, so it uses the rule's alternative, a total timeout above the expected generation time.

The answer check requires the first, middle and last item and the closing `END` line of each long answer, and the version number in each short one. Before, the long answers are missing, so the check fails on a real provider; that is the cost of the bug, not a flaw in the check.

## The diff

Same prompts, same output limit, same attempts limit. Only the timeout and the retry condition change.

```diff
--- before/app.ts
+++ after/app.ts
@@ -1,4 +1,5 @@
-// timeout-retry, before: a 2 s timeout on answers of up to ~2,000 tokens, retried on any error
-// (LP-GE-04, LP-GE-05). The server keeps generating each abandoned attempt, and the retry
-// pays for the prompt and the answer again.
+// timeout-retry, after: a timeout sized to the generation time, and a bounded retry with backoff
+// only for errors a retry can fix (LP-GE-04, LP-GE-05). Streaming with an idle timeout is the
+// preferred fix for long answers; this example stays non-streaming on purpose, so it uses the
+// rule's alternative: a total timeout above the expected generation time.
 
@@ -10,7 +11,24 @@
 
-const TIMEOUT_MS = 2_000;
+const SLOWEST_MS_PER_TOKEN = 50; // the slowest decode rate seen on this route
+const TIMEOUT_MS = Math.ceil(MAX_TOKENS * SLOWEST_MS_PER_TOKEN * 1.2);
 const MAX_ATTEMPTS = 3;
+const RETRYABLE = new Set([408, 409, 429, 500, 503, 504, 529]);
+const MAX_BACKOFF_MS = 30_000;
 
+/** The HTTP status of a failed call, from `status` or from a message such as "HTTP 429". */
+const statusOf = (e: unknown): number => Number((e as { status?: number }).status ?? /HTTP (\d{3})/.exec(String((e as Error)?.message))?.[1]);
+
+/** A 429 caused by an exhausted quota or credit keeps failing until access resumes: stop. */
+const isQuota = (e: unknown): boolean => {
+  const { type, code } = e as { type?: string; code?: string };
+  return /quota|credit|billing/i.test(`${type ?? ""} ${code ?? ""} ${(e as Error)?.message ?? ""}`);
+};
+
+/** Honours a `Retry-After` the error carries (seconds, as `retryAfter`); otherwise backs off exponentially. */
+const delayMs = (e: unknown, attempt: number): number =>
+  Math.min(((e as { retryAfter?: number }).retryAfter ?? 2 ** (attempt - 1)) * 1000, MAX_BACKOFF_MS);
+
 export function makeApp(opts: AppOptions = {}): ExampleApp {
   const dialect = opts.dialect ?? "openai.chat";
+  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
   const build = (input: string) => chatRequest(dialect, { system: SYSTEM, messages: [{ role: "user", text: input }], maxTokens: MAX_TOKENS });
@@ -32,4 +50,5 @@
               text = answerText((await client.send({ ...build(t.input), timeoutMs: TIMEOUT_MS })).body);
-            } catch {
-              // try again
+            } catch (e) {
+              if (!RETRYABLE.has(statusOf(e)) || isQuota(e)) break; // a timeout, a 400 or a spent quota would only repeat
+              if (attempt < MAX_ATTEMPTS) await sleep(delayMs(e, attempt));
             }
```

`before/app.ts` and `after/app.ts` are complete, small programs; `app.ts` returns one or the other. `scenario.ts` holds the questions and the expected answers, `check.ts` judges a run's answers, and `data.ts` holds the content both forms share.

## Providers

`createApp(form, { dialect })` builds `openai.chat` requests by default and `anthropic.messages` requests when the harness runs against Anthropic. Anthropic caches only up to a `cache_control` mark, so on that dialect both forms put one mark on the last system block (it covers the tools and the system prompt). The mark is in `examples/common.ts` and is the same in `before` and `after`; the fix is not a mark. Other providers cache by themselves and need nothing.

## Run it

```
npx tsx eval/run.ts --app timeout-retry --form before --target sim:openai
npx tsx eval/run.ts --app timeout-retry --form after --target sim:openai
```

The simulator's results are always marked `simulated` and are not quoted anywhere as measurements. A measured run needs your API keys and a spend cap: `--provider <name> --model <id> --runs 2 --budget-usd <n>`.

Offline, the app tells the simulator how long a token takes and how long each reply is (the `sim` field of the app), so the command-line run shows the timeouts a real provider would produce.
