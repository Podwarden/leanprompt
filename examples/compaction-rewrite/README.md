# compaction-rewrite

Rule: [LP-PC-08](../../skills/prefill-cache/rules/LP-PC-08.md), "Cache-aware compaction".

A support agent with a long system prompt (about 6,000 tokens) and one tool. In each of four sessions the customer states four facts about a ticket (courier, dock, order code, delivery day), the conversation is compacted after the fourth turn, and four more turns ask for those facts back.

**Before.** Compaction asks a separate summariser prompt for the summary and then writes it into the system prompt. The head changes at every compaction, so the long system prompt is read again at full price, and the summarising call has its own system prompt and pays for the whole history again.

**After.** The system prompt and the tool list stay byte-identical. The summarising call is the same head and history plus a final user message that asks for the summary, so it reads what the last turn wrote. The summary then goes in the messages as one labelled user message ("Summary of the conversation so far"), and the system prompt keeps its sentence about how to treat a summary.

After sends somewhat more prompt tokens in total, because its summarising call carries the head as well as the history; what the rule saves is the share of them that is read from the cache instead of computed again.

The last four turns can be answered only from the summary, so a compaction that lost a fact, or a summary the model no longer reads as context, fails the answer check.

## The diff

Same facts, same turns, same point of compaction. Only what the compaction rewrites changes.

```diff
--- before/app.ts
+++ after/app.ts
@@ -1,4 +1,4 @@
-// compaction-rewrite, before: compaction writes the summary into the system prompt and asks for it
-// with a separate summariser prompt (LP-PC-08). The head changes at every compaction, and the
-// summarising call reads the whole history again at full price.
+// compaction-rewrite, after: the system prompt and tools stay byte-identical, the summary goes in
+// the messages, and the summarising call continues the same prompt (LP-PC-08).
+// The head survives the compaction, and the summarising call reads the cache the last turn wrote.
 
@@ -23,3 +23,3 @@
       for (let session = 0; session < sc.sessions; session++) {
-        let system = BASE;
+        const system = BASE;
         let messages: Msg[] = [];
@@ -32,5 +32,4 @@
             const ask: Msg = { role: "user", text: SUMMARISE };
-            const summary = answerText((await client.send(chatRequest(dialect, { system: "You are a summariser.", messages: [...messages, ask] }))).body);
-            system = `${BASE}\n\nSummary of the conversation so far:\n${summary}`;
-            messages = [];
+            const summary = answerText((await client.send(chatRequest(dialect, { system, tools: TOOLS, messages: [...messages, ask] }))).body);
+            messages = [{ role: "user", text: `Summary of the conversation so far:\n${summary}` }];
           }
```

`before/app.ts` and `after/app.ts` are complete, small programs; `app.ts` returns one or the other. `scenario.ts` holds the questions and the expected answers, `check.ts` judges a run's answers, and `data.ts` holds the content both forms share.

## Providers

`createApp(form, { dialect })` builds `openai.chat` requests by default and `anthropic.messages` requests when the harness runs against Anthropic. Anthropic caches only up to a `cache_control` mark, so on that dialect both forms put one mark on the last system block (it covers the tools and the system prompt). The mark is in `examples/common.ts` and is the same in `before` and `after`; the fix is not a mark. Other providers cache by themselves and need nothing.

## Run it

```
npx tsx eval/run.ts --app compaction-rewrite --form before --target sim:openai
npx tsx eval/run.ts --app compaction-rewrite --form after --target sim:openai
```

The simulator's results are always marked `simulated` and are not quoted anywhere as measurements. A measured run needs your API keys and a spend cap: `--provider <name> --model <id> --runs 2 --budget-usd <n>`.

The check judges the eight answers of each session. The summarising call is an extra call in both forms, so a run makes nine calls per session.
