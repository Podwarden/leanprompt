# dated-chat

Rule: [LP-PC-03](../../skills/prefill-cache/rules/LP-PC-03.md), "No ids, timestamps, versions or paths at the top of the prompt".

A support assistant answers questions from a shop handbook (about 6,000 tokens). Four sessions of nine questions each.

**Before.** The first line of the system prompt is the current time to the second. Every call starts with a different line, so a provider that caches by prefix has nothing to reuse: the whole handbook is read again on each call.

**After.** The system prompt carries no date or time. The time goes into a labelled `<environment>` block at the top of the newest user message on each turn, which is what LP-PC-03's Fix recommends: the whole head stays equal across calls and sessions, and earlier messages keep the block they were sent with.

The answer check asks for a handbook figure on eight turns and, on the last turn of every session, a date that depends on today's date (the last day an item can be returned). The model gets today's date only from the time line, so a move that dropped or garbled it would fail the check.

## The diff

Same handbook, same questions, same session structure. Only where the time is written changes.

```diff
--- before/app.ts
+++ after/app.ts
@@ -1,3 +1,3 @@
-// dated-chat, before: the system prompt opens with the time to the second (LP-PC-03).
-// Every call starts with a different line, so the provider can reuse none of the prompt.
+// dated-chat, after: the time goes in a labelled block in the newest user message (LP-PC-03).
+// The system prompt is the same on every call, so the provider can reuse it.
 
@@ -9,7 +9,5 @@
 
-const systemPrompt = (now: Date): string => {
-  const first = `Current time: ${now.toISOString().slice(0, 19)}Z`;
-  return `${first}\nYou are a support assistant for a home-goods shop.\n${HANDBOOK}`;
-};
-const userText = (text: string, _now: Date): string => text;
+const systemPrompt = (_now: Date): string => `You are a support assistant for a home-goods shop.\n${HANDBOOK}`;
+const userText = (text: string, now: Date): string =>
+  `<environment>\nCurrent time: ${now.toISOString().slice(0, 19)}Z\n</environment>\n\n${text}`;
 
```

`before/app.ts` and `after/app.ts` are complete, small programs; `app.ts` returns one or the other. `scenario.ts` holds the questions and the expected answers, `check.ts` judges a run's answers, and `data.ts` holds the content both forms share.

## Providers

`createApp(form, { dialect })` builds `openai.chat` requests by default and `anthropic.messages` requests when the harness runs against Anthropic. Anthropic caches only up to a `cache_control` mark, so on that dialect both forms put one mark on the last system block (it covers the tools and the system prompt). The mark is in `examples/common.ts` and is the same in `before` and `after`; the fix is not a mark. Other providers cache by themselves and need nothing.

## Run it

```
npx tsx eval/run.ts --app dated-chat --form before --target sim:openai
npx tsx eval/run.ts --app dated-chat --form after --target sim:openai
```

The simulator's results are always marked `simulated` and are not quoted anywhere as measurements. A measured run needs your API keys and a spend cap: `--provider <name> --model <id> --runs 2 --budget-usd <n>`.

The app's clock moves 90 seconds per call unless `createApp` is given another, so an offline run sees the same changing time a real run would.
