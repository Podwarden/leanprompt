# Report template: `leanprompt-report.md`

Write the report with `npx leanprompt report --md`. It writes `leanprompt-report.md` at the project root from `.leanprompt/findings.json` and `.leanprompt/score.json`: everything from the title to "Questions for the owner" goes inside a generated block, so the report, the page and the hand-off block cannot disagree. You write the two sections below the block, "Inventory" and "Next steps"; a later `report --md` replaces the block and keeps them. To change the generated part, change the findings file and run it again. The template below shows what each section holds, in the order the page `npx leanprompt report --html` uses, and is what you write by hand only when the CLI cannot run (then replace every `<...>` and leave no placeholder). Keep the rule text out of it: link the rule file instead. The same content is what you present in the conversation ([presenting.md](presenting.md)); the file is the record.

The plain-English lines come from each finding's fields in `.leanprompt/findings.json` (`problem`, `change`, `why`, `estimate`, `assumptions`, `verify`), so write them for a person who has not read the rule: no rule ids in the sentences, no jargon. Rule links point at the rule file on GitHub, pinned to the leanprompt version, as on the page.

````markdown
# leanprompt report: <project name>

<date> · leanprompt <version> · target: <provider or engine, model family> · priority: <cost | speed | quality | weights>

**<n> places where this app pays for tokens it doesn't need.** The biggest: <rule title, plain> at <file>:<line>, about <tokens> tokens per 1,000 calls. Together about <total tokens> tokens per 1,000 calls (<"estimate from the code, not a measurement" | "measured over N calls">).<If there are open questions:> Plus <n> open questions to confirm; if they hold, add about <tokens>.<If there are server questions:> Plus <n> questions for the server's administrator, not in this app's score.<If there are notes:> Plus <n> other problems outside the rules, not scored.

`<n>` counts the app's confirmed findings only (including those marked "how often is assumed"), the same as the page: not the open questions, the questions for the server's administrator or the notes.

## What this costs you

<With `volume:` and a dated price in leanprompt.yaml:>
About <$X> a month at <N> calls a month. Fixing these saves about <$X> a month (about <Y> of an estimated <$B> monthly bill). <Self-hosted, with `prefill_tokens_per_second`: about <H> hours of GPU prefill time a month, and <+s> on the first-token time of the calls the prefill findings affect.>

Inputs: volume <N> calls a month (<source>); <model> input <$>, cached input <$>, output <$> per 1M tokens, from <pricing page URL or the user's source>, checked <date>; average call <prompt> prompt and <output> output tokens. Every figure is an estimate from the code, not a measurement (or: measured over N calls).

<Without them:> Tokens per 1,000 calls only. To see this in money, add `volume: {calls_per_month: N}` and `prices:` for <model> (input, cached_input, output per 1M tokens, with source and checked date) to `leanprompt.yaml`. leanprompt never invents a volume or a price.

| Finding | Where | Tokens per 1,000 calls | A month |
|---|---|---|---|
| <rule id> | <file>:<line> | <n prompt, n not cached, n output> | <$, or blank without volume and price> |

## What's wrong and what to change

Largest first, by estimated tokens lost per 1,000 calls. Findings that change price or latency but not tokens follow, in the order the priority gives them.

### 1. <problem, in a few words> · <file>:<line>

- **Problem:** <`problem`: what is wrong, one or two plain sentences>
- **What to change:** <`change`; a short diff if it fits>
- **Why it matters:** <`why`: why it costs tokens or time>
- **Estimate:** <`estimate`>, tokens lost per 1,000 calls (<estimate | measured, N calls>)
- **Assumes:** <`assumptions`: call mix, tokens per call, how often this path runs>
- **Share:** <0.000> of <prompt | output> tokens = <tokens lost per 1,000 calls> ÷ <that side's tokens for the same 1,000 calls>. <For a `both` finding with two shares: "<0.000> of prompt tokens and <0.000> of output tokens">. <Or: "severity default share: no estimate possible, because <reason>">
- **How often:** <only for `frequency-unknown`: "the code shows the problem; how often it happens is assumed. To measure it: <confirm>">
- **Already planned:** <only with `planned`: the issue or plan it belongs to>
- **Don't break meaning:** <the rule's check for this fix, or "caching only: answers cannot change">
- **How to check the fix:** <`verify`: the usage field that must change and the kvsig id that must stay equal>; proved with `measure-loop`
- **Rule:** [<rule id> <rule title>](<link to the rule file>)
- **Status:** <open | fixed, with the before and after line | skipped | ignored in leanprompt.yaml>

### Open questions

Findings outside this repository (`"<external>"`) or waiting on a fact (`needs-facts`), ranked the same way. They count in the score. Confirm or dismiss each one with its fact. Leave this heading out when there are none.

#### <n>. <problem, in a few words> · <where, for example "engine launch flags">

- **Problem:** <`problem`: why it may apply>
- **To confirm:** <the `confirm` text: the fact that would confirm or dismiss it, and where the user can read it>
- **Change, if confirmed:** <`change`>
- **Estimate:** <`estimate`> (estimate); <what it assumes about the missing fact>
- **Rule:** [<rule id> <rule title>](<link to the rule file>)
- **Status:** <open question | confirmed | dismissed>

## Questions for the server's administrator

Findings whose fix is a setting of the server or engine the app calls (`fix_by: "server"`; an `LP-LW-*` finding in `"<external>"` by default). They are not in this app's score (`npx leanprompt score --with-server` counts them). For an LM Warden server, `npx leanprompt profile detect --lmwarden <url>` reads the engine's cache facts. Leave this heading out when there are none.

#### <n>. <the question, in a few words> · <where>

- **Problem:** <`problem`, written as a question when it is not confirmed>
- **What would answer it:** <`confirm`>
- **Change, if confirmed:** <`change`>
- **Rule:** [<rule id> <rule title>](<link to the rule file>)
- **Status:** question for the server's administrator

## Other problems the audit found

The `notes` of the findings file: verified problems outside the rules, never scored. Leave this heading out when there are none.

### N<n>. <title> · <file>:<line>

- **Problem:** <`problem`>
- **What to change:** <`change`>
- **Why it matters:** <`why`>
- **How to check the fix:** <`verify`>

## Fix it with your coding agent

Paste this into Claude Code, Codex, Cursor or any coding assistant. It checks each finding against the code and proposes fixes one at a time, asking before it changes anything.

```text
Please check and fix the LLM-call findings from a leanprompt audit of this repository.

1. If the leanprompt skills are not installed for you here, install them: npx leanprompt install
2. Read .leanprompt/findings.json and leanprompt-report.md. If they are missing, use the list below.
3. Check each finding against the code before you change anything. The audit can be wrong: if a finding does not hold, tell me why and leave that code alone.
4. Fix one finding at a time. Show me the change as a small diff and apply it only after I say yes.
5. Prove each fix with the measure-loop skill: a before and after on the same scenario. Ask me before running anything that sends real, billed requests.
6. When a fix is proved, set "fixed": true on its finding in .leanprompt/findings.json and run npx leanprompt score.

Findings, largest first:
1. <rule id> at <file>:<line>: <problem>

Open questions (confirm before fixing):
- <rule id> (<where>): <problem> To confirm: <confirm>

Questions for the server's administrator (not this app's code; do not change the app for these):
- <rule id> (<where>): <problem> What would answer it: <confirm>

Other problems found outside the rules (check each against the code first; not scored):
- <title> (<file>:<line>): <problem> Change: <change>
```

## Score

<score> <kind>, from <".leanprompt/findings.json" | ".leanprompt/usage.jsonl, N calls (M unmeasured)">, <default | calibrated> weights. One number from 0 to 100 for how well the app avoids paying for the same tokens twice; higher is better.

<Static only:> <N> of <M> findings use a default share (`default_shares` in `.leanprompt/score.json`), the rest an estimated one.

| Input | Value | Meaning |
|---|---|---|
| E | <0.00> | prefill reuse (measured), or the prefill term from the findings (static) |
| S | <0.00> | prefix stability (measured); 1 in a static score |
| G | <0.00> | share of output tokens wasted |

<Measured only:> Heads: <distinct_head> distinct heads over <conversations> conversations. <One line: expected, or which finding it points to.>

<Static only:> This score is an estimate from code. A trial run with `npx leanprompt calibrate` fits it to this app.

<Static, with server questions:> This is the app's own score: it leaves out <n> findings for the server's administrator; with them it would be <score>.

Money is not part of the score.

## Questions for the owner

What the audit could not ask (an unattended run) or the user did not answer: the priority (cost, speed or quality), the volume (calls a month) and the prices. Each with the `leanprompt.yaml` key that answers it. Leave this heading out when every one is answered.

- **Priority:** <the question, and "answer with `priority:` in leanprompt.yaml">

<!-- leanprompt:report:end, in the written file: everything above is generated by report --md -->

## Inventory

| # | File | Provider | Model | Call kind | Notes |
|---|---|---|---|---|---|
| 1 | <path>:<line> | <provider, or "unknown: asked"> | <model> | <chat · agent loop · one-shot · batch> | <wrapper it goes through, router, framework> |

## Next steps

1. <The fix to do first and why: the biggest leak, or the one the priority favours>
2. <Prove it with `measure-loop`: the scenario to run, the field to watch>
3. <Turn on the usage logger to get a measured score, if there is no log yet>
4. <Calibrate the static score, if it is static>
5. <Add volume and prices to `leanprompt.yaml`, if the report shows tokens only>
6. <The page: `npx leanprompt report --html` writes `.leanprompt/report.html` with the same content and the copyable hand-off block>
````

Write the numbers with their kind every time: "(estimate)" next to a figure from code, "(measured, N calls)" next to a figure from the usage log. A static score is never presented as measured, and money is shown only from the user's own volume and a price with its source and checked date; never invent either.
