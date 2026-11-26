# Calibrating the static score

`leanprompt score --static` turns the audit's findings into a score with default
weights. Those defaults are estimates: a finding rated `high` is assumed to waste
half of the prefill work (0.5), `medium` a fifth (0.2) and `low` one twentieth
(0.05). `leanprompt calibrate` compares the audit's findings with a measured score
from your own usage log and scales those defaults to fit your application.

## When to calibrate

- You have run the audit and want the static score to be closer to what your
  application does in practice.
- You have a usage log of at least 50 calls, either from real traffic or from a
  trial run (below).

If you have a usage log, `leanprompt score --measured` already gives a measured
score. Calibration is for the static score: it lets you keep scoring from findings
(for example after a fix, before new traffic exists) with weights tuned on a
measurement.

## Making a trial run

A trial run is a fixed set of inputs sent through your application with the usage
logger turned on.

1. Turn on the usage logger in the application (see the `measure-loop` skill). It
   writes `.leanprompt/usage.jsonl`. The log holds ids, counts and flags, never
   prompt or completion text.
2. Prepare a fixed list of inputs that looks like real use: several conversations
   or sessions, with follow-up turns, not one request repeated. Use the same list
   each time you run it, so runs can be compared.
3. Send the inputs through the application. Make at least 50 calls in total. A
   measured score needs 50 measured calls; calls that failed or could not be
   identified do not count toward it.
4. Run:

   ```
   leanprompt calibrate --findings .leanprompt/findings.json --usage .leanprompt/usage.jsonl --synthetic
   ```

   Pass `--synthetic` when the log came from a trial run rather than real traffic.
   The weights file records which one it was.

Both paths default to the files under `.leanprompt/` in the current directory, and
`--dir <project>` points at another project.

## What it does

The method keeps the ratios between severities (0.5 : 0.2 : 0.05) and solves two
scale factors:

- `k_prefill`, chosen so that the static prefill term (E x S) equals the measured E x S;
- `k_gen`, chosen so that the static waste term (G) equals the measured G.

Each factor is found by bisection. A scaled share is capped at 0.95, so a
measured value beyond what the cap allows is not reached: for example, a measured
E x S of 0 cannot be matched, because the static E x S cannot fall below 0.05 per
prefill finding. The command reports that side as `capped`, stores the smallest
factor that reaches the closest achievable value (1.9 for a single `high`
finding), and prints that value. If the measured value is on the other side of
what the explicit shares already give, the side is reported as `unreachable` and
treated as not calibratable. The command prints the measured score, the static score before and after,
and both factors, then asks `write .leanprompt/weights.json? [y/N]`. Nothing is
written without an answer of `y`, or `--yes` on the command line. When standard
input is not a terminal and `--yes` is absent, nothing is written and the command
says how to run it again.

Findings that the profile's `ignore:` list names are left out, exactly as in
`leanprompt score --static`, and findings marked `fixed` are skipped, so the
calibrated static score matches what `score --static` prints afterwards.

Only the default severity shares are scaled. A finding that carries its own
`share` in the findings file keeps it. If every prefill finding has its own share,
`k_prefill` cannot change the score, and the command reports the prefill side as
not calibratable and writes 1 for it; the same holds for the generation side, and
for a side reported as `unreachable`. If neither side can be calibrated, nothing
is written.

The weights file looks like this:

```json
{ "v": 1, "shares": { "high": 0.5, "medium": 0.2, "low": 0.05 },
  "k_prefill": 1, "k_gen": 1, "source": "synthetic", "calls": 60, "date": "YYYY-MM-DD" }
```

`shares` records the base shares the factors apply to. It is informational: the
score reads `k_prefill` and `k_gen`. `source` is `real` or `synthetic`, and a
static score computed with a weights file is labelled `calibrated` in
`score.json` and on the badge.

## What it does not change

- The 0.6 / 0.4 split between the prefill term and the waste term.
- The formula of the measured score. The measured score is the same for everyone
  given the same log, so measured badges stay comparable between projects.
- Anything in your code or your usage log.

A weights file affects only static scores. It is a fit to one application at one
point in time; run the command again after the application or its traffic changes
substantially.

## Sharing the cost split

`calibrate` also prints the share of prompt tokens among all tokens in the log.
This counts tokens, not prices, and is not used in the fit. If you want to
contribute it to the project, you can add it to an issue, together with the
provider and model. It is entirely optional. leanprompt sends nothing anywhere and
makes no network calls when you run `calibrate`.
