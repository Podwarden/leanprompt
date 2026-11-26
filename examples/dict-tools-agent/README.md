# dict-tools-agent

Rule: [LP-PC-04](../../skills/prefill-cache/rules/LP-PC-04.md), "Fixed tool order and JSON key order".

An operations assistant has twelve tools and picks the right one for each of eight requests (it answers with the tool name; nothing is executed). Four sessions. Each session registers the tools again, the way a plugin loader would: in whatever order they arrive, from a seeded shuffle so a run can be repeated.

**Before.** The tool list is `Object.values(registry)`, so its order, and the key order inside each schema, change from session to session. The tool block is part of the prompt prefix, so each new session starts without a cache hit. Inside a session the list is built once and stays equal.

**After.** The list is sorted by name and every schema is serialised with sorted keys, so the prompt prefix is identical in every session.

The answer check looks for the tool name in each reply. The tools, descriptions and `required` lists are the same in both forms.

## The diff

Same tools, same system prompt, same requests. Only the order of the tool list and the key order inside schemas change.

```diff
--- before/app.ts
+++ after/app.ts
@@ -1,5 +1,5 @@
-// dict-tools-agent, before: the tool list comes out of an object filled in whatever order the
-// tools registered, and each schema keeps its own key order (LP-PC-04). It differs per session.
+// dict-tools-agent, after: the tool list is sorted by name and every schema has sorted keys
+// (LP-PC-04), so it is the same in every session.
 
-import { answerText, chatRequest, rng, type ToolDef } from "../../common.js";
+import { answerText, chatRequest, rng, sortKeys, type ToolDef } from "../../common.js";
 import type { AppOptions, ExampleApp } from "../../types.js";
@@ -9,3 +9,3 @@
 
-const toolList = (registry: Record<string, ToolDef>): ToolDef[] => Object.values(registry);
+const toolList = (registry: Record<string, ToolDef>): ToolDef[] => Object.keys(registry).sort().map((name) => sortKeys(registry[name]));
 
```

`before/app.ts` and `after/app.ts` are complete, small programs; `app.ts` returns one or the other. `scenario.ts` holds the questions and the expected answers, `check.ts` judges a run's answers, and `data.ts` holds the content both forms share.

## Providers

`createApp(form, { dialect })` builds `openai.chat` requests by default and `anthropic.messages` requests when the harness runs against Anthropic. Anthropic caches only up to a `cache_control` mark, so on that dialect both forms put one mark on the last system block (it covers the tools and the system prompt). The mark is in `examples/common.ts` and is the same in `before` and `after`; the fix is not a mark. Other providers cache by themselves and need nothing.

## Run it

```
npx tsx eval/run.ts --app dict-tools-agent --form before --target sim:openai
npx tsx eval/run.ts --app dict-tools-agent --form after --target sim:openai
```

The simulator's results are always marked `simulated` and are not quoted anywhere as measurements. A measured run needs your API keys and a spend cap: `--provider <name> --model <id> --runs 2 --budget-usd <n>`.
