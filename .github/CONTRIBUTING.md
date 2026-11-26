# Contributing to leanprompt

Issues and pull requests are welcome. leanprompt is maintained by the LM Warden Team; how decisions are made is in [GOVERNANCE.md](GOVERNANCE.md).

## What to edit

- `skills/`, `providers/`, `models/`, `runtimes/` and `docs/` are the source of truth. Never edit `forms/`, `.claude-plugin/` or the generated block in `AGENTS.md` by hand: `npm run build:forms` regenerates them, and CI fails when they are stale.
- Provider facts (limits, minimums, prices, cache lifetimes) live only in `providers/<name>.md` and `models/<family>.md`, each with a `checked: YYYY-MM-DD` date and a `source:` link. Defaults of HTTP clients and runtimes (timeouts) live in `runtimes/<name>.md` the same way, with a source URL on every table row. Rules link to those pages instead of repeating the facts. CI warns when an entry is older than 90 days.
- Keep the tone of [docs/DESIGN.md](../docs/DESIGN.md) section 10: neutral about providers, no hype, no "up to" figures, no exclamation marks.

## Adding or changing a rule

Copy [skills/_template/RULE.md](../skills/_template/RULE.md) into the skill's `rules/` folder. A rule is merged only when:

1. It has every required section, in order: `Rule`, `Why`, `Detect in code`, `Fix`, `Don't break meaning`, `Verify`, `Waste signal`. **Verify** says how to prove the fix: the provider's usage field across two requests, and the kvsig id that must stay equal.
2. It has evidence: either a measured example (a row in [docs/evidence.md](../docs/evidence.md), or an example app under `examples/` with a measured result under `eval/results/`), or a dated provider-doc source (`evidence: [{doc: <url>, checked: YYYY-MM-DD}]`). A rule with only a doc source says "documented, not yet measured here".
3. Its fix keeps meaning. A change that saves tokens but changes answers is not a fix.

Rule ids (`LP-PC-nn`, `LP-GE-nn`, `LP-PD-nn`, `LP-LW-nn`) are stable and never reused.

## Numbers

Every number with a unit (%, seconds, a multiplier, tokens, dollars) in the README, a page under `docs/` or a skill cites an evidence row as `(E<n>)` or links a result file under `eval/results/` whose `kind` is `measured`. Simulator results are never quoted. `npm run check:numbers` enforces this. A new evidence row needs its source, date and limits.

## Running the checks

Node 20.19 or newer:

```
npm ci
npm run lint:rules          # rule frontmatter, sections, evidence ids
npm run lint:facts          # provider and model tables
npm run build:forms         # regenerate forms/, .claude-plugin/ and the AGENTS.md block
npm run build:forms -- --check
npm run check:numbers
npm run typecheck
npm test
npm run build
```

The Python logger: `cd python && uv run --with pytest pytest`.

`npm run eval -- --app <name> --form before|after --target sim:openai` replays an example app against the local simulator at no cost. Pointed at a real provider (`--provider`, `--model`) it sends billed requests under a spend cap; do not commit those results without a maintainer.

## Sign-off (DCO)

Every commit carries a Developer Certificate of Origin sign-off (https://developercertificate.org/), as in kvsig:

```
git commit -s -m "your message"
```

which adds `Signed-off-by: Your Name <you@example.com>`. Pull requests with unsigned commits cannot be merged.

## Share a lesson learned

If leanprompt helped you, or a rule misled you, open a "Lesson learned" issue on GitHub with the issue form (`.github/ISSUE_TEMPLATE/lesson-learned.yml`). Describe the case in general terms: no code, keys, hostnames, customer or company names. A maintainer reviews every submission before it informs a rule, and submitted text is never pasted into a skill. Credit in [docs/THANKYOU.md](../docs/THANKYOU.md) is optional: if you want it, it can include your name and, if you want to promote it, your project with a link; a project link is listed as given, without endorsement. Contributions are under CC BY 4.0.

## License

By contributing you agree that code (`cli/`, `eval/`, `examples/`, `python/`, `scripts/`) is under Apache-2.0 and documentation and skills text (`skills/`, `providers/`, `models/`, `runtimes/`, `docs/`, README) under CC BY 4.0.
