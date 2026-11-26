---
name: llm-call-audit
description: Use when asked to audit, review or reduce the cost or latency of an app that calls LLMs (chatbots, agents, RAG, extraction pipelines, evals, batch jobs) through Anthropic, OpenAI, Gemini, OpenRouter, DeepInfra, LangChain, LlamaIndex, LiteLLM, the Vercel AI SDK, raw HTTP, or a self-hosted vLLM, SGLang or LM Warden server; when someone asks "where does this app pay for the same tokens twice", wants a leanprompt score or badge, or wants a ranked list of LLM-call fixes. Finds every LLM call, checks it against the leanprompt rules, ranks the findings by tokens lost, and writes leanprompt-report.md and .leanprompt/findings.json.
license: CC-BY-4.0
---

# llm-call-audit

Finds every place an app calls an LLM and every place it pays for the same tokens twice: prompts the provider's cache could have reused and did not, and output the app generated and then threw away. Each finding is tied to a rule, a file and line, an estimate of the tokens it loses per 1,000 calls, one fix, and a way to verify the fix. The result is a report, `leanprompt-report.md`, a findings file, `.leanprompt/findings.json`, and a score from the leanprompt CLI.

The audit owns no rules of its own. It finds the calls and applies the rules of the other four skills:

- [prefill-cache](../prefill-cache/SKILL.md): `LP-PC-*`, prompts the cache can reuse.
- [generation-economy](../generation-economy/SKILL.md): `LP-GE-*`, calls and output that are not wasted.
- [lmwarden](../lmwarden/SKILL.md): `LP-LW-*`, self-hosted servers.
- [measure-loop](../measure-loop/SKILL.md): how each fix is proved, and the score.

The audit never edits code without asking. It proposes one fix per finding, the user decides, and each applied fix is handed to `measure-loop` to prove.

Ask first: before you edit the app's code, install a package, add a file outside `.leanprompt/`, or run anything that sends requests to a provider (they are billed), show the change or the command and ask. The user may prefer to run it themselves. No ask is needed for the audit's own `leanprompt-report.md` and `.leanprompt/findings.json`, or for `npx leanprompt score`, `npx leanprompt report --html` and `npx leanprompt calibrate`, which only read and write files under `.leanprompt/` and make no network calls (`calibrate` still writes `.leanprompt/weights.json` only after `y` or `--yes`). Offering to share a lesson (below) needs no ask, but running `npx leanprompt lesson` does: it writes `.leanprompt/lesson.md`, so run it only after the user says yes.

## When to use

- The user asks to audit an LLM-calling app, to cut its token bill or latency, or to find out why its provider reports few cached tokens.
- The user wants a leanprompt score or the README badge.
- A new codebase arrives and you want to know what it calls, with which model, and how.

For a single change you are writing right now (a new prompt builder, a new retry), use `prefill-cache` or `generation-economy` directly; the audit is for the whole app.

## Workflow

1. **Know the target and priority.** Read `leanprompt.yaml` at the project root ([docs/profile.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.6/docs/profile.md)): `target` (provider or self-hosted engine, model family, context length), `engine` (self-hosted cache facts), `priority` (cost, speed, quality or weights) and `ignore`. If the file is absent, infer the target from the code ([call-shapes.md](call-shapes.md), "Which provider and model") and ask for what the code cannot tell you, above all the priority; then offer to save the answers to `leanprompt.yaml` so they are not asked again, show the lines that would be written, and write them only on a yes ([presenting.md](presenting.md)). When the app has more than one backend (a self-hosted engine and a hosted API chosen at run time, or one per call site), record each as its own `targets` entry, with the call sites' files under `files:` when they are known; the same offer applies: show the lines and write them only on a yes. For an LM Warden server, offer `npx leanprompt profile detect --lmwarden <url>`, which reads the engine facts from the server instead of asking (the [lmwarden](../lmwarden/SKILL.md) skill describes it).
2. **Inventory the calls.** Find every call site with [call-shapes.md](call-shapes.md): SDKs, frameworks, raw HTTP (search the path without the version too, `chat/completions`, `/messages`, `/responses`, because the base URL usually ends in `/v1`, and the request body with a `messages` list near the HTTP call), and the app's own wrappers. A search hit is a candidate: open it and confirm it is a request the app really sends before listing it (a doc comment or a test string is not a call). For each, record file and line, provider, model and call kind (chat, agent loop, one-shot, batch), and follow it back to where its system prompt, tools, history and request options are built.
3. **Check the rules.** For each call site, walk the parts of the request through the rule map below and open a rule file when its "Detect in code" pattern matches. With several backends, evaluate the rules per backend: a call site that can go to either is checked once for each, and `applies_to` is checked against each finding's backend, not against the app as a whole. Raise a rule when its `applies_to` frontmatter includes the target, or includes `any`: a rule marked `any` is provider-independent (the fix is the same on every target) and applies to every call, including calls to a host with no provider table (DeepSeek, Groq, Together, Azure and other OpenAI-compatible hosts); `applies_to` restricts only the provider-specific rules. For a provider-specific rule on a host with no table, raise it only if that host's own documentation shows the feature (say which page); otherwise write "unknown, check the provider's docs" and do not assume. Drop any finding whose rule and file are on the `ignore:` list.
4. **Read the usage, if there is any.** If `.leanprompt/usage.jsonl` exists, run `npx leanprompt score` first and read its inputs and its heads diagnostic (below); they confirm, correct or add to what the code shows.
5. **Estimate and rank.** Give each finding an estimate of the tokens it loses per 1,000 calls (below), labelled as an estimate or as measured, and rank by it. Turn each estimate into the finding's `share` and `tokens_per_1k`, and write its plain-English `problem`, `change`, `why`, `estimate`, `assumptions` and `verify` ("The findings file", below). Before proposing any cache mark, apply the break-even rule (below).
6. **Ask for volume and prices.** Ask how many calls the app makes a month and offer to look up the current price ("Volume and prices", below), so the report can say what the findings cost. Skip it if the user declines: the report then shows tokens only.
7. **Write the files.** Write `.leanprompt/findings.json` (format below), run `npx leanprompt score`, write `leanprompt-report.md` at the project root from [report-template.md](report-template.md), and run `npx leanprompt report --html` for the page the user reads and shares.
8. **Present and decide.** Show the summary first, then one finding at a time as a decision, as [presenting.md](presenting.md) describes. For each finding the user wants fixed, show one fix as a small diff and apply it only after the user says yes.
9. **Prove each fix.** Ask before running anything that sends requests or adds files, then hand over to `measure-loop` (below), mark the finding `fixed` and rescore.
10. **Offer calibration** after a static score (below).
11. **Offer to share a lesson** after a measured result or a rule that misled (below).

## Rule map: where each rule looks

| Part of the request | Rules |
|---|---|
| Cache marks (Anthropic, and Anthropic or Gemini models behind a router) | [LP-PC-01](../prefill-cache/rules/LP-PC-01.md), [LP-PC-11](../prefill-cache/rules/LP-PC-11.md) |
| System prompt: what comes first, what varies per call, user or session | [LP-PC-02](../prefill-cache/rules/LP-PC-02.md), [LP-PC-03](../prefill-cache/rules/LP-PC-03.md), [LP-PC-07](../prefill-cache/rules/LP-PC-07.md) |
| Tool list and JSON serialisation | [LP-PC-04](../prefill-cache/rules/LP-PC-04.md), [LP-PC-05](../prefill-cache/rules/LP-PC-05.md) |
| History, compaction, attachments | [LP-PC-06](../prefill-cache/rules/LP-PC-06.md), [LP-PC-08](../prefill-cache/rules/LP-PC-08.md), [LP-PC-10](../prefill-cache/rules/LP-PC-10.md) |
| Thinking, reasoning effort, output limits | [LP-PC-09](../prefill-cache/rules/LP-PC-09.md), [LP-GE-03](../generation-economy/rules/LP-GE-03.md) |
| Model, key and route per request | [LP-PC-12](../prefill-cache/rules/LP-PC-12.md), [LP-GE-08](../generation-economy/rules/LP-GE-08.md) |
| Loops and fan-out over calls | [LP-GE-01](../generation-economy/rules/LP-GE-01.md), [LP-GE-02](../generation-economy/rules/LP-GE-02.md), [LP-GE-06](../generation-economy/rules/LP-GE-06.md), [LP-GE-07](../generation-economy/rules/LP-GE-07.md) |
| Timeouts, retries, streaming, parsing, edits | [LP-GE-04](../generation-economy/rules/LP-GE-04.md), [LP-GE-05](../generation-economy/rules/LP-GE-05.md), [LP-GE-09](../generation-economy/rules/LP-GE-09.md), [LP-GE-10](../generation-economy/rules/LP-GE-10.md) |
| Self-hosted server: launch flags, replicas, keys | [LP-LW-01](../lmwarden/rules/LP-LW-01.md), [LP-LW-02](../lmwarden/rules/LP-LW-02.md), [LP-LW-03](../lmwarden/rules/LP-LW-03.md) |

An `lm-warden` target counts as `vllm` when you match `applies_to`, as it does for the cache tables. With no known target, check every rule and say which ones depend on the provider. A known target with no table of its own is not an unknown target: apply the `any` rules, and treat the provider-specific ones as above.

The priority changes the order and the advice, not what counts as waste: follow the priority-aware advice in [generation-economy](../generation-economy/SKILL.md). Caching never changes answers, so the `LP-PC-*` findings apply under every priority. Findings that change price or latency but not tokens (a batch API, LP-GE-07; a smaller model, LP-GE-08) have no tokens lost to rank by; list them after the token findings, in the order the priority gives them.

## Estimating tokens lost per 1,000 calls

Findings are ranked by the tokens each one loses per 1,000 calls of the whole app, so a large leak on a rare call ranks below a small leak on every call. Write each number with its kind: "(estimate)" when it comes from the code, "(measured, N calls)" when it comes from the usage log.

With no usage log, estimate it from the code, as the product of three things, and say it is an estimate:

1. **Tokens lost on an affected call.** For a prefill finding, the size of the part of the prompt the cache could have reused and now recomputes: everything from the first byte that changes to the end of the otherwise stable part, in the provider's render order (the "Why" of each rule gives the order). For a generation finding, the output tokens of the call that is repeated, retried or thrown away, or the prompt tokens of a context sent once per question or sample (LP-GE-01, LP-GE-02). Count tokens with the provider's tokenizer or token-counting endpoint when you can; otherwise estimate from the text's length and say so.
2. **How often a call is affected.** A value that changes on every call (a timestamp, a request id) affects every call; a value that changes per session or per user affects the first call of each session or user; a history rewrite affects every turn after it; a retry on truncation affects the calls that hit the limit.
3. **This call site's share of the app's calls,** from the call kind: an agent loop makes many calls per task, a title or label call one per conversation. When you cannot tell, treat the call sites as equal and say so.

Apply the provider's limits before you multiply: a prefix shorter than the provider's minimum cacheable size loses nothing, and a self-hosted engine reuses only whole blocks. Those numbers are in [providers/](https://github.com/Podwarden/leanprompt/tree/v0.1.0-dev.6/providers/) and in `leanprompt.yaml`'s `engine:` block; read them there.

With a usage log, measure instead. `.leanprompt/usage.jsonl` holds `prompt_tokens`, `cached_tokens` and `output_tokens` per call and no file or line, so match records to a call site by provider, model and `ids.head`, and count the prompt tokens that were not cached on calls that continue a conversation, and the output tokens of repeated, retried and parse-failed calls ([generation-economy](../generation-economy/SKILL.md), "Reading the usage record"). Where a record cannot be matched to one call site, keep the code estimate for that finding.

## Volume and prices

The tokens a finding loses per 1,000 calls become money only with two facts the code does not hold: how many calls the app makes, and what a token costs. leanprompt never invents either, and the page and the report show tokens only until both are known.

- **Volume.** Ask how many calls the app makes a month. With a usage log, infer it from the log instead (records over the days the log covers, scaled to a month) and say that is where it came from. Record it as `volume: {calls_per_month: N, source: "..."}`; with `targets:`, give each entry its own `volume:`.
- **Prices.** Offer to look up the current price of each model on the provider's pricing page, and give the date you read it; or take the user's own price (a contract, a reseller). Record it under `prices:` by model name, in US dollars per million tokens: `input`, `output`, `cached_input` (needed to price tokens the cache could have served) and `cache_write` when the provider charges for it, with `source` (the page's URL, or where the user's price comes from) and `checked` (the date, `YYYY-MM-DD`). A price without a source and a date is rejected.
- **Self-hosted.** There is no token price; offer `prefill_tokens_per_second` under `engine:` (or the entry's `engine_facts:`), the engine's measured prefill throughput, so the page can show GPU prefill time a month and the first-token time a finding adds.

Show the lines that would be written and offer to save them to `leanprompt.yaml`; write them only on a yes, as for the other answers ([docs/profile.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.6/docs/profile.md)). If a finding's calls go to one of several priced models, set its `model` to that model's name in `prices:`.

## The break-even rule for cache marks

Before recommending a cache mark, apply the break-even rule in [LP-PC-01](../prefill-cache/rules/LP-PC-01.md): where the provider charges a premium for cache writes, a prefix that is not read again within the cache lifetime costs more marked than unmarked. Estimate how often each marked prefix returns within the lifetime: from the usage log, by the time between records with the same `ids.head` or `ids.nodes` prefix; from the code, by the call kind (a chat or agent loop returns within seconds, a one-shot prompt may never return, a nightly job returns once a day). Then advise one of four things: mark, don't mark, longer lifetime, restructure (move the varying part after the stable one so a mark can cover more). The write and read prices and the lifetimes are in [providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.6/providers/anthropic.md) and the other provider tables; LP-PC-11 covers pauses longer than the lifetime.

## The heads diagnostic

After `npx leanprompt score` writes a measured score, read `diagnostics.heads` in `.leanprompt/score.json`: `distinct_head` is how many distinct heads (system prompt and tools together) the log holds, and `conversations` how many distinct conversations. An app whose call sites each send one fixed head should show about as many distinct heads as it has distinct prompts (roles, agents, call sites), however many conversations it logged. Many distinct heads for the conversation count, growing as `conversations` grows, means something per session, per user or per compaction is in the head. The score cannot see this: its stability figure counts only requests that continue a conversation, so a head that differs between conversations costs reuse on every first request without lowering it (E4, E5). Look for LP-PC-03 (a per-session value at the top of the prompt), LP-PC-07 (per-user context before shared context) and LP-PC-08 (compaction that rewrites the system prompt and starts a new conversation), and raise the one the code shows, with the counts as its evidence.

## The findings file

`.leanprompt/findings.json` is what `npx leanprompt score --static` reads. Write it from the code as it is now, one entry per finding (the same rule in two files is two entries):

```json
{
  "v": 1,
  "average_call": { "prompt_tokens": 4500, "output_tokens": 900 },
  "findings": [
    { "rule": "LP-PC-03", "file": "src/agent/prompt.ts", "line": 12, "saves": "prefill", "severity": "high", "share": 0.42,
      "tokens_per_1k": { "uncached": 1890000 },
      "problem": "The system prompt starts with the current time, so it is different on every call and the provider cannot reuse any of it.",
      "change": "Move the time out of the system prompt into the newest user message.",
      "why": "Every call pays full price for the whole 1,900-token system prompt instead of the cached price.",
      "estimate": "about 1.9M prompt tokens per 1,000 calls not served from cache",
      "assumptions": "every call goes through this prompt; the system prompt is about 1,900 tokens",
      "verify": "On the second of two requests a minute apart, cached tokens rise from 0 to about the size of the system prompt." },
    { "rule": "LP-GE-05", "file": "app/llm.py", "line": 40, "saves": "generation", "severity": "high", "fixed": true },
    { "rule": "LP-LW-01", "file": "<external>", "where": "vLLM launch flags on the inference host", "saves": "prefill", "severity": "high",
      "status": "needs-facts", "confirm": "the engine's block size and whether --prefix-match-unit is set" }
  ]
}
```

The numbers in this example are illustrative, not from a real app.

- `rule`: an existing rule id. An unknown id, or any malformed entry, makes `score` stop with an error that names it.
- `file`: the path relative to the project root, with forward slashes. The `ignore:` list matches on this exact string. For a finding that lives outside the repository (an engine's launch flags, a gateway's config, a server you only call), write `"<external>"` and say where in `where`.
- `line`: the line the fix changes, a positive integer. For `"<external>"` it is optional (0 or left out).
- `where` (required with `"<external>"`): free text naming the place, for example "engine launch flags".
- `status` (optional): `needs-facts` when whether the finding holds depends on a fact the code cannot show (the engine's block size, the share of traffic on a path). It then needs `confirm`: the fact that would confirm or dismiss it, written as something the user can check.
- `saves`: `prefill`, `generation` or `both`, from the rule's frontmatter.
- `severity`: `high`, `medium` or `low`, as the rule's "Waste signal" assigns it for the shape you found (several rules give different severities for different shapes).
- `share` (required for every finding): the fraction, from 0 to 1, of the app's prompt tokens (prefill) or output tokens (generation) this finding wastes, derived from its tokens-lost-per-1,000-calls estimate above: share = estimated tokens lost on the affected side per 1,000 calls ÷ that side's tokens for the same 1,000 calls (prompt tokens for `prefill`, output tokens for `generation`, over all the app's calls, not only the affected ones). Write the assumptions behind both numbers in the report (call mix, tokens per call, how often the affected path runs). For a `both` finding the score applies the one share on each side: compute it for both, record the larger, and give both in the report. Fall back to the severity default (leave `share` out) only when no estimate is possible, and say so in the report, with the reason. `npx leanprompt score --static` prints how many findings used a default (`default_shares: N of M`). `leanprompt calibrate` does not rescale a share you set.
- `fixed` (optional): `true` once the fix is applied and proved. The score skips fixed findings.
- `tokens_per_1k` (on every finding you can estimate): the tokens it loses per 1,000 calls of the whole app, split by how they are billed: `uncached` (prompt tokens the cache could have served), `prompt` (prompt tokens sent that need not be sent at all, such as a retry's), `output` (output tokens thrown away), and `measured_calls` when the numbers come from a usage log of that many calls. The page sums them, ranks by them, and with a volume and prices turns them into money ("Volume and prices", above).
- `model` (optional): the model name in `prices:` this finding's calls use, when there are several.
- The plain-English fields, on every finding: `problem` (what is wrong, in one or two sentences a person who has not read the rule follows; no rule ids or jargon), `change` (what to change), `why` (why it costs tokens or time), `estimate` (the number as words, for example `"about 138k tokens per 1,000 calls"`), `assumptions` (what the estimate assumes) and `verify` (how to prove the fix). Plain text, each at most 600 characters: the page and the hand-off block for the user's coding agent are built from them. Older files without them stay valid.
- `average_call` (top level, optional): the average call's `prompt_tokens` and `output_tokens` you assumed for the shares, so the page can give the saving as a share of the bill.

Record every finding you have grounds for, even when it is outside the repository or waits on a fact: leaving it out because it has no file and line hides what may be the largest item. `"<external>"` and `needs-facts` findings count in the static score with their share and severity like any other; the report lists them under "Open questions" with their `confirm` text, so the user can settle each one.

## The score

`npx leanprompt score` scores the project and writes `.leanprompt/score.json`, which is also the source of the README badge (shields.io's endpoint badge reads that file). With no flags it picks the measured score when `.leanprompt/usage.jsonl` exists and the static score from `.leanprompt/findings.json` otherwise; `--measured <file>` or `--static <file>` chooses, and `--dir <project>` points at another project. It prints `leanprompt score: <score> <kind>` with the inputs E, S and G.

- **Measured** needs at least 50 measured calls. With fewer, `score` writes nothing, prints how many measured calls it found and suggests `--static`; then run `npx leanprompt score --static`. A measured score.json records the calls it used, the unmeasured ones, and the diagnostics above.
- **Static** scores the findings file, leaving out the findings the `ignore:` list names and the ones marked `fixed`. It is an estimate from code, labelled `static` and shown with a grey badge.

Always quote the score with its kind. How the score is computed, and where the measured one stops, is in [measure-loop](../measure-loop/SKILL.md) ("Where the measured score stops").

## Calibrating a static score

After a static score, offer a trial run with `npx leanprompt calibrate` to fit the static weights to this app. The trial run needs the usage logger in the app ([measure-loop](../measure-loop/SKILL.md), "Log every call"; propose it as a diff and add it only on a yes) and a fixed set of realistic inputs sent through the app (several sessions with follow-up turns, at least 50 calls in total). Those are real, billed requests, so the user runs them, or you ask before running them. Then run `npx leanprompt calibrate --synthetic`, which itself makes no calls and only marks the log as a trial run; with a log of real traffic instead, run `npx leanprompt calibrate` without `--synthetic`. It compares the findings with the measured score of that log, prints the static score before and after and the two scale factors, and asks before it writes `.leanprompt/weights.json`; nothing is written without `y`, or `--yes`. Run from a tool with no terminal, it prints the comparison and writes nothing: show the user the result, and run it again with `--yes` only if they agree. Static scores computed after that say `calibrated`. Calibration scales only the default shares, so once every finding carries an estimated share it matters less, and with no default share left it has nothing to scale. Once a usage log exists, plain `npx leanprompt score` gives the measured score; pass `--static` to see the calibrated static one. Method and limits: [docs/calibration.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.6/docs/calibration.md).

## Proving each fix

Each fix is handed over to `measure-loop`, which runs the rule's "Verify" step as a before and after on the same scenario (the provider's usage fields across two requests, and the kvsig ids that must stay equal) and rescores. The user's `fix now` covers the one diff you showed, nothing more, so ask before each of the other steps:

- **The before and after run.** Ask the user to run the scenario, or ask whether you may run it yourself, and say that it sends real requests to the provider, which are billed. Do not start it without a yes.
- **The stable-head test.** Offer it separately, as its own small diff (the new test file), and add it only after the user says yes. It keeps the fix from quietly coming undone, and it runs offline. Report the proof as one before and after line per field ([presenting.md](presenting.md)), then set `fixed: true` on the finding and run `npx leanprompt score` again. A fix that can change answers (a reorder, a smaller model, less thinking, shorter outputs) needs its answer check to pass first; the rule's "Don't break meaning" says which check (E6 is why).

## Sharing a lesson

After a fix has a measured before and after, or when a rule misled the user (it did not fit their app, or the fix changed answers), offer once to share what happened as a "lesson learned". It is an offer, not a step: say what it is, and never run it unasked. Only after the user says yes, run `npx leanprompt lesson --rule <id>` (add `--before <an older score.json>` when they kept one). It writes a draft to `.leanprompt/lesson.md` on their machine from the rule id, the target and the current score; it contains no code, paths, prompts or model output, and nothing is sent anywhere.

The user reads the exact text, edits it, and opens the issue themselves: the command prints a link to the "Lesson learned" form on GitHub, which carries no text from the draft, and the user pastes the draft into the form. A maintainer reads every submission before it informs a rule, and credit is optional ([THANKYOU.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.6/docs/THANKYOU.md)). If `lesson` reports something to remove (a key, an email, a path, a host name), help the user remove it and run it again; do not paste the removed text anywhere. Do not offer after a static score alone: there is no before and after to share.

## What this skill does not do

It does not edit code on its own, it does not change answers to save tokens, it does not judge model choice beyond routing obviously small calls, and it does not promise a saving for an app it has not measured. Money is not in the score; when the report shows it, it uses the prices in [providers/](https://github.com/Podwarden/leanprompt/tree/v0.1.0-dev.6/providers/) with their checked date. Prompt Lens, an LM Warden view of where reuse broke, is planned; until it ships, the kvsig ids and the provider's usage fields are the tools.
<!-- leanprompt:generated v0.1.0-dev.6 — managed by npx leanprompt init; local edits are replaced on update -->
