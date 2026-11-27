# leanprompt in CI

Back to the [README](../README.md).

`leanprompt score --github` turns an audit's findings into GitHub Actions annotations, so each open finding shows on its file and line in the run and on the pull request. It reads `.leanprompt/findings.json`, which the audit writes and you commit; it makes no network call and runs no model.

## A minimal workflow

```yaml
# .github/workflows/leanprompt.yml
name: leanprompt
on: [pull_request]
permissions:
  contents: read
jobs:
  score:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx --yes leanprompt@0.1.0-dev.15 score --static --github
```

Pin a version, so a new release cannot change a build without a commit.

## What it prints

- One line per open finding, which GitHub shows as a warning on that file and line:
  `::warning file=src/agent/prompt.ts,line=12,title=leanprompt LP-PC-03%3A ...::The system prompt starts with the current time ...`
  A finding outside the repository (`"file": "<external>"`) is annotated without a file, with where it lives. An open question (`"status": "needs-facts"`) says what would confirm it. A finding for the server's administrator is annotated too, and says so; it is not in the app's score (`--with-server` counts it).
- One summary line, shown as a notice: the score with its kind, and how many findings are open.
- The usual `score` output, and `.leanprompt/score.json` as on your machine.

Findings marked `"fixed": true`, and the ones the `ignore:` list in `leanprompt.yaml` names, are left out, as in the static score.

## Exit codes

| Code | When |
|---|---|
| 0 | Scored, whatever the findings. A finding never fails a build by default. |
| 1 | A file is missing or invalid (`findings.json`, `leanprompt.yaml`, `weights.json`). |
| 2 | A flag is wrong. |
| 3 | Only with `--fail-under N`: the score is below `N`. |

To fail a pull request on the score, add `--fail-under 80` (or your own threshold). A static score is an estimate from the code; once the app has a usage log, `score --measured` gives a measured one ([score.md](score.md)).

## Keeping the findings current

The annotations are only as current as the committed `findings.json`. Run `/leanprompt audit` again after larger changes to the app's LLM calls, and commit the new file with them.
