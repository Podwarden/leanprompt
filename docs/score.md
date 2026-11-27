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

A change to the formula or its weights, or to which findings it counts, is a minor version and is listed in the [changelog](CHANGELOG.md). Before 1.0, a development release (`0.1.0-dev.N`) may change it too, and its changelog entry says so under "Score change".

## Measured and static

There are two kinds, always labelled.

- A **measured** score comes from the usage log (`score --measured`). It needs at least 50 measured calls and states how many it used; with fewer, it refuses and suggests `--static`. The usage logger is described in [how-it-works.md](how-it-works.md#prove-it-measure-change-measure).
- A **static** score comes from the audit's findings (`score --static`) and is an estimate, with a lighter badge colour. It is the app's own score: every finding about the app's code counts, including those recorded as `"file": "<external>"` (outside the repository), `"status": "needs-facts"` (behaviour not confirmed), `"status": "frequency-unknown"` (the code shows it, only how often is assumed) or `"status": "size-unknown"` (the code shows it and how often, only the tokens each time are assumed). Findings for the server's administrator do not count by default, and neither do findings the project already knows about (below).

## The app's score and the server's questions

Some findings are about the server or engine the app calls, not about the app's code: an engine's cache block size or match unit, its replicas, its keys, the chat template it serves. Their fix is a server setting that the app's developer may not control, and counting them made an app that is careful with its own calls look worse than its code.

A finding is for the server's administrator when it has `"fix_by": "server"`; an `LP-LW-*` finding recorded in `"<external>"` gets that by default (write `"fix_by": "app"` to count it as the app's). The static score leaves these findings out: the formula is the same, over the app's findings only. `score.json` records how many there were (`diagnostics.server_findings`) and the score with them counted (`server.with_server_score` and `server.with_server_inputs`), and `score --static --with-server` makes that the headline score instead (its message says `with server`). The report page and `leanprompt-report.md` list these findings in their own section, "Questions for the server's administrator", each with what would answer it; for an LM Warden server, `leanprompt profile detect --lmwarden <url>` reads the engine's cache facts. The measured score is unchanged: it already treats the engine's block rounding as the engine's rule, not the app's.

**This is a score change, in 0.1.0-dev.13.** A static score from a findings file with server findings can be higher than the same file scored by 0.1.0-dev.12, and `score --with-server` gives the old figure. Files with no server findings score the same as before. See the [changelog](CHANGELOG.md).

## What the project already knows, and overlapping findings

Two kinds of finding change how the static score counts, from 0.1.0-dev.14.

- **Already known to the project.** Before it writes the findings, the audit searches the project's issues, pull requests and docs for each one, and records a match in `known` with its link and kind: `planned`, `in-progress`, `reported` or `declined` (the older `planned` text field counts as `planned`). Such a finding is not new waste the audit found: the project has it in hand, or has decided against it. It is left out of the static score, out of the headline count and out of the totals. `score.json` records how many there were (`diagnostics.known_findings`) and the score with them counted (`known.with_known_score`, `known.with_known_inputs`). The page lists them under "Already known to the project", with planned, in-progress and reported work linked, and declined findings as one line each with the link and no proposed change.
- **Overlapping findings.** When one fix covers two findings, or fixing one shrinks the other, the audit links them with `overlaps` (by finding `id`). Each group of overlapping findings counts once: on each side, the largest share in the group enters the formula, and the page's totals take the largest token figure in the group. Findings without `overlaps` add up as before.

**This is a score change, in 0.1.0-dev.14.** A findings file with known or planned findings can score higher than it did in 0.1.0-dev.13 (`known.with_known_score` in `score.json` is the old figure); one with `overlaps` can score higher than the same findings without them. A file with neither scores the same as before.

Each finding in a static score weighs its `share`: the fraction of prompt tokens (prefill) or output tokens (generation) it wastes. The audit derives it from its estimate of the tokens the finding loses per 1,000 calls, divided by that side's tokens for the same calls, and writes the assumptions in the report. A finding that saves both prefill and output can give the two sides separately, `share_prefill` and `share_output`, when they differ (a truncation retried unchanged loses mostly output, because the resent prompt is read from the cache); `share` alone applies to both sides. `share: 0` is allowed, for a finding that costs no tokens; the page lists such a finding but does not count it as a place that wastes tokens. A correctness rule (`saves: none`, LP-GE-11, a spend meter that undercounts) is recorded as a note and never enters the score. A finding with no share at all uses its severity's default share (high 0.5, medium 0.2, low 0.05). `score --static` prints how many findings did, as `default_shares: N of M`, and stores the same counts in `score.json` under `diagnostics` (`{"default_shares": N, "findings": M}`); `report --html` shows them next to the score. The more defaults, the less the static score says about your app.

With no flag, `score` uses `.leanprompt/usage.jsonl` when it exists and `.leanprompt/findings.json` otherwise.

## Calibrate the static score

`leanprompt calibrate` fits the static weights to your app from a trial run, so the static score tracks what a measurement would say. How to make the trial run: [calibration.md](calibration.md).

## The badge

Commit `.leanprompt/score.json` and point shields.io's endpoint badge at its raw URL:

```markdown
![leanprompt](https://img.shields.io/endpoint?url=<raw URL of .leanprompt/score.json in your repo>)
```

The report page (`leanprompt report --html`) fills the URL in for you when it can: it reads `git remote get-url origin` and the current branch (local git calls only, nothing goes over the network), and builds the raw URL for GitHub, GitLab.com and Bitbucket remotes. For any other host, or a repository with no remote, it says that the badge needs a public repository with `score.json` committed and shows no snippet, because shields.io could not read the file. When `score.json` is not tracked by git yet, it says to commit it first. The page offers the badge, a star and a message for a colleague only after it has shown something concrete: an estimate on a finding, or a measured score.

Why the badge is honest: it reads your own committed file, not a number we host. The file carries the score, its kind, its inputs, the number of calls, the date (the local date on the machine that ran it) and the leanprompt version. A static score is labelled `static` and is always grey, because it is an estimate from the audit's findings, not a measurement; only a measured score gets a colour. There is no hosted service and no upload. Anyone can rerun `leanprompt score` on the repository: the file is the evidence.
