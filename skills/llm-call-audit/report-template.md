# Report template: `leanprompt-report.md`

Write the report at the project root with the four sections below, in this order. Replace every `<...>`; leave no placeholder in the written report. Keep the rule text out of it: link the rule file instead. The same content is what you present in the conversation ([presenting.md](presenting.md)); the file is the record.

````markdown
# leanprompt report: <project name>

<date> · leanprompt <version> · target: <provider or engine, model family> · priority: <cost | speed | quality | weights>

<n> call sites, <n> findings, score <score> <static | measured | static, calibrated>.
Biggest leak: <rule id> at <file>:<line>, <tokens> tokens lost per 1,000 calls (<estimate | measured, N calls>).

## Inventory

| # | File | Provider | Model | Call kind | Notes |
|---|---|---|---|---|---|
| 1 | <path>:<line> | <provider, or "unknown: asked"> | <model> | <chat · agent loop · one-shot · batch> | <wrapper it goes through, router, framework> |

## Findings

Ranked by estimated tokens lost per 1,000 calls. Findings that change price or latency but not tokens follow, in the order the priority gives them.

### 1. <rule id> <rule title> · <file>:<line>

- **Rule:** [<rule id>](<link to the rule file>)
- **Tokens lost per 1,000 calls:** <number> (<estimate | measured, N calls>); <one line on how it was estimated>
- **What the code does:** <one or two sentences, with the line>
- **Fix:** <one fix, the smallest change; a short diff if it fits>
- **Don't break meaning:** <the rule's check for this fix, or "caching only: answers cannot change">
- **Verify:** <the usage field that must change, for example cached tokens on the second request, and the kvsig id that must stay equal>; proved with `measure-loop`
- **Status:** <open | fixed, with the before and after line | skipped | ignored in leanprompt.yaml>

## Score

<score> <kind>, from <".leanprompt/findings.json" | ".leanprompt/usage.jsonl, N calls (M unmeasured)">, <default | calibrated> weights.

| Input | Value | Meaning |
|---|---|---|
| E | <0.00> | prefill reuse (measured), or the prefill term from the findings (static) |
| S | <0.00> | prefix stability (measured); 1 in a static score |
| G | <0.00> | share of output tokens wasted |

<Measured only:> Heads: <distinct_head> distinct heads over <conversations> conversations. <One line: expected, or which finding it points to.>

<Static only:> This score is an estimate from code. A trial run with `npx leanprompt calibrate` fits it to this app.

<Optional:> Money is not part of the score. <Cost per 1,000 calls before and after, from providers/<name>.md, prices checked <date>.>

## Next steps

1. <The fix to do first and why: the biggest leak, or the one the priority favours>
2. <Prove it with `measure-loop`: the scenario to run, the field to watch>
3. <Turn on the usage logger to get a measured score, if there is no log yet>
4. <Calibrate the static score, if it is static>
5. <Add the badge: commit `.leanprompt/score.json` and point shields.io's endpoint badge at it>
````

Write the numbers with their kind every time: "(estimate)" next to a figure from code, "(measured, N calls)" next to a figure from the usage log. A static score is never presented as measured.
