# Presenting the audit

leanprompt has no interface of its own. The conversation with you, the user's coding assistant, is the interface: you show the results, ask the questions and apply the fixes. This page says how.

## Summary first

Lead with a summary first, in three or four lines, before any detail: how many call sites the audit found, how many findings, the score with its kind (static, static calibrated, or measured), and the single biggest leak with its file:line and its tokens lost per 1,000 calls. Then stop and offer to go through the findings. Do not open with the inventory table or the rule list.

```
leanprompt audit: <n> call sites, <n> findings, score <score> <kind>.
Biggest leak: <rule id> <rule title> at <file>:<line>, about <tokens> tokens lost per 1,000 calls (<estimate | measured, N calls>).
Full report written to leanprompt-report.md. Go through the findings one by one?
```

## One finding at a time

Go through the findings one at a time, in ranked order. Present each one as a decision: the rule id and title, file:line, the tokens it loses per 1,000 calls with the kind of that number, one sentence on what the code does there, and the one fix you propose. Then offer exactly four choices: `fix now`, `explain more`, `skip`, `don't flag this again`.

- `fix now`: show the fix as a small diff and apply it. If the fix moves or rewords content, ask the reorder question below first. `fix now` consents to that diff only. To prove it, ask the user to run the before and after scenario, or ask whether you may run it yourself and say that it sends real requests to the provider, which are billed. Offer the stable-head test as its own small diff, and add it only after the user says yes.
- `explain more`: explain the rule's "Why" and "Don't break meaning" in plain words, using the lines from this code, and link the rule file. Then offer the same four choices again.
- `skip`: leave the finding open (Status: skipped in the report) and move on. The next audit reports it again.
- `don't flag this again`: see below.

Choosing `don't flag this again` writes an `ignore:` entry to `leanprompt.yaml`, the rule id and the file exactly as they appear in `.leanprompt/findings.json`, for example `{rule: LP-PC-03, file: src/agent/prompt.ts}`. Append it to the `ignore:` list, create the list (or the file) if it is missing, and keep every other key and comment as it was. The entry covers that rule in that whole file, not one line. From then on the audit does not report it, and `npx leanprompt score` leaves it out of the static score (as does `leanprompt calibrate`); the measured score is unaffected, because it reads the usage log, not the findings. The user undoes it by deleting the line. Tell the user which line you added.

Present each open question (a finding in `"<external>"` or with `status: "needs-facts"`) in its place in the ranking, marked as an open question: say where it lives, the tokens it would lose with the kind of that number, and its `confirm` text as the question to settle. If the user gives the fact and it confirms the finding, drop `status` and go on with the four choices; if it dismisses the finding, remove it from `.leanprompt/findings.json` and rescore; if the user does not know yet, leave it open: it stays in the score and in the report's "Open questions".

Accept a short answer: the choice's words, its number, or "yes" for `fix now`. After the last finding, say what changed: fixed, skipped and ignored counts, and the new score with its kind.

## Asking questions

When you have your own question tool, use it: in Claude Code, the option prompts of its question tool (`AskUserQuestion`), which show the choices as options the user picks from. Without one, write numbered choices in text, one per line, and accept the number or the words as the answer. Ask one question at a time.

Ask only what the code cannot answer. Read everything you can first: the SDK, the base URL, the model names, the launch files, `leanprompt.yaml`. The questions that are usually left:

- **The priority** (cost, speed or quality, or weights), when `leanprompt.yaml` is absent or has no `priority`. It decides the order of the advice; caching applies whatever the answer.
- **Whether a reorder may change answers,** before a fix that moves content (LP-PC-02, LP-PC-07, or LP-PC-03 when a value moves to a later message). Moving a date away from the text that refers to it is the known failure (E6). Say what would move and where.
- **The provider or model,** only when the code reads it from the environment at run time and nothing else names it.

Offer to save each answer to `leanprompt.yaml` so it is never asked twice: show the lines that would be written (the priority under `priority:`, the provider or engine under `target:`, or one entry per backend under `targets:` when the app calls more than one, [docs/profile.md](../../docs/profile.md)) and write them only on a yes. Answering a question is not consent to writing the file; if the user declines, keep the answer for this session only. The file accepts only `target` (or `targets`), `engine`, `priority` and `ignore`, and any other key makes leanprompt stop with `unknown key`, so do not add keys of your own. A "no, the order matters" to a reorder question can be saved, on the same offer, as an `ignore:` entry for that rule and file, so the content stays where it is. A "yes" needs no entry: the fix is made, with its answer check, and the finding is gone.

## Fixes and proofs

Show each fix as a small diff: only the lines that change, in a `diff` block, with the file path. One fix per finding, the smallest one in the rule's "Fix", and no refactoring around it. If the fix needs an answer check, say which one before you apply it.

```diff
--- a/src/agent/prompt.ts
+++ b/src/agent/prompt.ts
-const systemPrompt = (now: Date) => `Current time: ${now.toISOString()}\n${BASE_PROMPT}`;
-const userText = (text: string, _now: Date) => text;
+const systemPrompt = (_now: Date) => BASE_PROMPT;
+const userText = (text: string, now: Date) =>
+  `<environment>\nCurrent time: ${now.toISOString()}\n</environment>\n\n${text}`;
```

The time still reaches the model, in the newest message, so a question about the date can still be answered; this is the LP-PC-03 fix in the `dated-chat` example app, and it is a move, so it gets the reorder question and an answer check first.

Show each proof as a before/after line, one per field, in the form `cached_tokens: 0 → 18,432`, with the numbers from your own before and after runs of the same scenario. Use the field the provider reports (`cache_read_input_tokens` on Anthropic; the table is in [measure-loop](../measure-loop/SKILL.md)), and add the generation fields when the fix is a generation one (`output_tokens`, retries, `finish: "length"` counts). Name the run each number came from. When the proof is a kvsig id, say which id stayed equal across which two inputs.

## Offering to share a lesson

After the last finding, if one fix now has a measured before and after, or a rule misled the user, add one line offering to share it as a "lesson learned": "If you like, `npx leanprompt lesson` drafts a short, general-terms write-up on your machine. You read the exact text and open the GitHub issue yourself; nothing is sent." The user reads the exact text and opens the issue themselves. Offer it once and accept a no. Run `npx leanprompt lesson --rule <id>` only after the user says yes, then point them at `.leanprompt/lesson.md` and the link it prints. Do not offer it for a static score alone, and never paste anything the user removed from the draft. A maintainer reads every submission before it informs a rule; credit is optional ([THANKYOU.md](../../docs/THANKYOU.md)).

## Large audits and sharing

When there are more than 10 findings, or the user wants to share the result, offer `npx leanprompt report --html`, which writes the findings and the score into one local, self-contained HTML page and prints its path. The Markdown report, `leanprompt-report.md`, stays the record either way.
