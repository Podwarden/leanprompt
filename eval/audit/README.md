# Audit evaluation

This folder measures how well an AI coding assistant finds LLM-call problems in code when it follows the `llm-call-audit` skill. Each case is a small program with problems placed on purpose. The assistant audits it, and `leanprompt eval-audit` scores what it reported.

Nothing here is run against a real model API. The fixture code is never executed, and all names in it are made up.

## Layout

```
eval/audit/
  fixtures/<language>/<case>/before/   code with the problems placed on purpose
  fixtures/<language>/<case>/after/    the same code with the problems fixed
  expected/<case>.json                 where the problems are
```

`expected/<case>.json` is a list of `{"rule", "file", "line"}`. The file path is relative to the case directory, and the rule is a rule id such as `LP-PC-01`. Together the cases place every rule in `prefill-cache` and `generation-economy` at least once.

Cases: `python/support-bot`, `python/agent-loop`, `python/batch-jobs`, `python/doc-edits`, `ts/review-service`, `ts/triage-fetch` (a raw `fetch` to a URL built from a base that ends in `/v1`), `go/summary-worker`.

## Run one

Give the assistant only one form at a time. A copy of the whole case would let it compare `before/` with `after/` and read off the problems.

1. Copy only the contents of `before/` to a folder outside this repository:
   `cp -R eval/audit/fixtures/python/support-bot/before /tmp/support-bot-before`
2. Open that folder in the assistant (Claude Code, Codex, Cursor, Gemini CLI or another one that can load the skills) with the leanprompt skills installed.
3. Ask: "Audit this folder for LLM call waste with the llm-call-audit skill and write `.leanprompt/findings.json`." Give no hints about the rules or the lines.
4. Score it from the repository root:
   `npx leanprompt eval-audit eval/audit/fixtures/python/support-bot /tmp/support-bot-before/.leanprompt/findings.json --form before`
5. Repeat with a separate copy of `after/` and `--form after`.

Paths in the findings may be relative to the copied folder (`bot.py`) or absolute (`/tmp/support-bot-before/bot.py`). A path with a `before/` or `after/` folder in it is read as that form, using the part after it. A path that matches no file of the case is listed under "unmatched paths" with a warning on stderr, and counts as neither a hit nor a false positive.

## How scoring works

- A reported finding matches an expected one when the rule is the same, the file is the same, and the line is within 3 lines.
- Recall is matched expected findings divided by expected findings. Each reported finding matches at most one expected finding. It is reported for `--form before` runs only.
- The missed list shows the expected findings that were not matched.
- On an `after` run, every finding is a false positive: those files have the problems fixed, so a finding means the assistant flagged correct code.
- Findings on `before/` files that are not in the answer key are not counted, so precision on `before/` is not measured. The cases are small but may hold other real issues.
- Case names are unique across languages; the command stops with an error if they are not.

The command prints the numbers and exits 0 whatever they are. It exits 2 when an input is missing or invalid. It is a measuring tool, not a pass/fail check.

## Recording a result

Runs are manual. Save each one as `eval/results/audit-<assistant>-<case>-<date>.json`:

```json
{
  "v": 1,
  "assistant": "claude-code",
  "model": "model name or version as the assistant shows it",
  "case": "support-bot",
  "date": "2026-11-26",
  "recall": 0.75,
  "falsePositives": 0
}
```

- `assistant`: the tool that ran the audit.
- `case`: the case folder name.
- `date`: the day of the run, `YYYY-MM-DD`.
- `recall`: the number printed by `eval-audit`, from 0 to 1.
- `falsePositives`: the count printed for the `after` run.
