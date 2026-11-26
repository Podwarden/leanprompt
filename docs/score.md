# The score and the badge

`leanprompt score` turns either your usage log or the audit's findings into one number from 0 to 100, and writes it with its inputs to `.leanprompt/score.json`. Back to the [README](../README.md).

```
leanprompt score
```

## The formula

The number is `floor(100 × (0.6 × E × S + 0.4 × (1 − G)))`, shown with its inputs:

- **E**, prefill reuse: cached prompt tokens over reusable prompt tokens, where reusable is capped by the provider's own rules (minimum size, block or step size, breakpoints, cache lifetime).
- **S**, prefix stability: reusable over prompt tokens on requests that continue an earlier one.
- **G**, generation waste: output tokens spent on repeated calls, retried truncations and parse failures, over all output tokens.

A change to the formula or its weights is a minor version and is listed in the [changelog](CHANGELOG.md).

## Measured and static

There are two kinds, always labelled.

- A **measured** score comes from the usage log (`score --measured`). It needs at least 50 measured calls and states how many it used; with fewer, it refuses and suggests `--static`. The usage logger is described in [how-it-works.md](how-it-works.md#prove-it-measure-change-measure).
- A **static** score comes from the audit's findings (`score --static`) and is an estimate, with a lighter badge colour. Every finding counts, including those recorded as `"file": "<external>"` (outside the repository) or `"status": "needs-facts"` (waiting on a fact); the report lists those as open questions.

Each finding in a static score weighs its `share`: the fraction of prompt tokens (prefill) or output tokens (generation) it wastes. The audit derives it from its estimate of the tokens the finding loses per 1,000 calls, divided by that side's tokens for the same calls, and writes the assumptions in the report. A finding with no `share` uses its severity's default share (high 0.5, medium 0.2, low 0.05). `score --static` prints how many findings did, as `default_shares: N of M`, and stores the same counts in `score.json` under `diagnostics` (`{"default_shares": N, "findings": M}`); `report --html` shows them next to the score. The more defaults, the less the static score says about your app.

With no flag, `score` uses `.leanprompt/usage.jsonl` when it exists and `.leanprompt/findings.json` otherwise.

## Calibrate the static score

`leanprompt calibrate` fits the static weights to your app from a trial run, so the static score tracks what a measurement would say. How to make the trial run: [calibration.md](calibration.md).

## The badge

Commit `.leanprompt/score.json` and point shields.io's endpoint badge at its raw URL:

```markdown
![leanprompt](https://img.shields.io/endpoint?url=<raw URL of .leanprompt/score.json in your repo>)
```

The file carries the score, its kind, its inputs, the number of calls, the date and the leanprompt version. There is no hosted service and no upload. Rerun it yourself: the file is the evidence.
