# repeat-samples

Rule: [LP-GE-01](../../skills/generation-economy/rules/LP-GE-01.md), "n samples in one request".

An assistant answers lookup questions about a synthetic field survey log (invented stations, names and readings, about 6,000 tokens) and takes a majority vote over four samples of each answer. Four sessions of eight questions each.

**Before.** One request per sample. The log is the same in every request, so each sample pays to prefill it again, and the samples gain nothing from that: they differ only in what is generated.

**After.** One request with `n` set to the number of samples. The log is prefilled once and all the samples are decoded from it. The temperature is the same as before, and the code reads every choice, not only the first, so the vote sees all the samples.

Support for `n` differs by provider and by model: check [providers/openai.md](../../providers/openai.md) and the other files in [providers/](../../providers/) before you rely on it. Where `n` is unavailable, the samples are sent one after another, with the same `cache_control` mark as in `before` so the later samples can read the cache. The code does this for the Anthropic dialect, and for any endpoint that answers 400 to `n`.

The answer check expects the observer's surname in the voted answer of each question.

## The diff

Same log, same questions, same temperature and vote. Only how the samples are requested changes.

```diff
--- before/app.ts
+++ after/app.ts
@@ -1,5 +1,6 @@
-// repeat-samples, before: one request per sample (LP-GE-01). The survey log is the same in every
-// request, so each sample pays to prefill it again; the samples differ only in what is generated.
+// repeat-samples, after: one request that asks for all the samples with `n` (LP-GE-01).
+// The log is prefilled once and the samples are decoded from that prefill. Where `n` is not
+// available the samples are sent one after another, so the later ones can read the cache.
 
-import { answerText, chatRequest } from "../../common.js";
+import { answerText, answerTexts, chatRequest } from "../../common.js";
 import type { AppOptions, ExampleApp } from "../../types.js";
@@ -19,4 +20,4 @@
   const dialect = opts.dialect ?? "openai.chat";
-  const build = (input: string) =>
-    chatRequest(dialect, { system: SYSTEM, messages: [{ role: "user", text: input }], maxTokens: 40, extra: { temperature: TEMPERATURE } });
+  const build = (input: string, n?: number) =>
+    chatRequest(dialect, { system: SYSTEM, messages: [{ role: "user", text: input }], maxTokens: 40, extra: { temperature: TEMPERATURE, ...(n ? { n } : {}) } });
   return {
@@ -26,9 +27,18 @@
     check,
-    buildRequest: (input) => build(input),
+    buildRequest: (input) => build(input, dialect === "openai.chat" ? SAMPLES : undefined),
     async run(client, sc) {
       const answers: string[] = [];
+      let nSupported = dialect === "openai.chat"; // Anthropic has no `n`; a model that rejects it answers 400
       for (let session = 0; session < sc.sessions; session++) {
         for (const t of sc.turns) {
-          const samples: string[] = [];
-          for (let k = 0; k < SAMPLES; k++) samples.push(answerText((await client.send(build(t.input))).body));
+          let samples: string[] = [];
+          if (nSupported) {
+            try {
+              samples = answerTexts((await client.send(build(t.input, SAMPLES))).body);
+            } catch (e) {
+              if ((e as { status?: number }).status !== 400) throw e;
+              nSupported = false;
+            }
+          }
+          for (let k = 0; !nSupported && k < SAMPLES; k++) samples.push(answerText((await client.send(build(t.input))).body));
           answers.push(vote(samples));
```

`before/app.ts` and `after/app.ts` are complete, small programs; `app.ts` returns one or the other. `scenario.ts` holds the questions and the expected answers, `check.ts` judges a run's answers, and `data.ts` holds the content both forms share.

## Providers

`createApp(form, { dialect })` builds `openai.chat` requests by default and `anthropic.messages` requests when the harness runs against Anthropic. Anthropic caches only up to a `cache_control` mark, so on that dialect both forms put one mark on the last system block (it covers the tools and the system prompt). The mark is in `examples/common.ts` and is the same in `before` and `after`; the fix is not a mark. Other providers cache by themselves and need nothing.

## Run it

```
npx tsx eval/run.ts --app repeat-samples --form before --target sim:openai
npx tsx eval/run.ts --app repeat-samples --form after --target sim:openai
```

The simulator's results are always marked `simulated` and are not quoted anywhere as measurements. A measured run needs your API keys and a spend cap: `--provider <name> --model <id> --runs 2 --budget-usd <n>`.

Each question is sampled four times, so a measured run makes more calls in `before` than in `after`. Set the spend cap with that in mind.
