# rag-chunks-first

Rule: [LP-PC-07](../../skills/prefill-cache/rules/LP-PC-07.md), "Shared context before per-user context".

A parts-support assistant answers questions about a catalogue. Each question comes with three retrieved chunks (the right one and two near neighbours with different figures), and the system prompt carries long shared instructions (about 6,000 tokens). Four sessions of eight questions each.

**Before.** The retrieved chunks open the system prompt, ahead of the shared instructions. Every question retrieves different chunks, so the long shared part that follows them starts at a different place on every call and a provider that caches by prefix has nothing to reuse.

**After.** The system prompt is the shared instructions and nothing else. The chunks go in a labelled `<retrieved>` block at the top of the user message, which is what LP-PC-07's Fix recommends for the narrower layers: the whole head stays equal across calls and sessions. The instructions say where the chunks are ("in the `<retrieved>` block of the user message"), because the rule asks to update instructions that referred to them by position.

The answer check asks for the load figure and the id of the chunk it came from. The neighbours' chunks carry other figures, so an answer that read the wrong chunk, or no chunk because the move lost them, fails the check.

## The diff

Same instructions, same chunks, same questions. Only where the chunks are written changes.

```diff
--- before/app.ts
+++ after/app.ts
@@ -1,4 +1,4 @@
-// rag-chunks-first, before: the retrieved chunks open the system prompt, ahead of the shared
-// instructions (LP-PC-07). Every question retrieves different chunks, so the long shared part
-// that follows them is never at the same place twice and the provider can reuse none of it.
+// rag-chunks-first, after: the system prompt is the shared instructions and nothing else; the
+// retrieved chunks go in a labelled block at the top of the user message (LP-PC-07).
+// The system prompt is the same on every call, so the provider can reuse it.
 
@@ -10,6 +10,5 @@
 
-const systemPrompt = (chunks: Chunk[]): string =>
-  `Retrieved chunks for this question:\n${render(chunks)}\n\n` +
-  `You are a parts-support assistant. Answer only from the chunks at the top of this prompt and cite the id of the chunk you used.\n${GUIDELINES}`;
-const userText = (text: string, _chunks: Chunk[]): string => text;
+const systemPrompt = (_chunks: Chunk[]): string =>
+  `You are a parts-support assistant. Answer only from the chunks in the <retrieved> block of the user message and cite the id of the chunk you used.\n${GUIDELINES}`;
+const userText = (text: string, chunks: Chunk[]): string => `<retrieved>\n${render(chunks)}\n</retrieved>\n\n${text}`;
 
@@ -24,3 +23,3 @@
     check,
-    buildRequest: (input, ctx) => build([{ role: "user", text: input }], retrieveFor(input, ctx.session)),
+    buildRequest: (input, ctx) => build([{ role: "user", text: userText(input, retrieveFor(input, ctx.session)) }], retrieveFor(input, ctx.session)),
     async run(client, sc) {
```

`before/app.ts` and `after/app.ts` are complete, small programs; `app.ts` returns one or the other. `scenario.ts` holds the questions and the expected answers, `check.ts` judges a run's answers, and `data.ts` holds the content both forms share.

## Providers

`createApp(form, { dialect })` builds `openai.chat` requests by default and `anthropic.messages` requests when the harness runs against Anthropic. Anthropic caches only up to a `cache_control` mark, so on that dialect both forms put one mark on the last system block (it covers the tools and the system prompt). The mark is in `examples/common.ts` and is the same in `before` and `after`; the fix is not a mark. Other providers cache by themselves and need nothing.

## Run it

```
npx tsx eval/run.ts --app rag-chunks-first --form before --target sim:openai
npx tsx eval/run.ts --app rag-chunks-first --form after --target sim:openai
```

The simulator's results are always marked `simulated` and are not quoted anywhere as measurements. A measured run needs your API keys and a spend cap: `--provider <name> --model <id> --runs 2 --budget-usd <n>`.
