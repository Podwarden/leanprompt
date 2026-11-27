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

Choosing `don't flag this again` writes an `ignore:` entry to `leanprompt.yaml`, the rule id and the file exactly as they appear in `.leanprompt/findings.json`, for example `{rule: LP-PC-03, file: src/agent/prompt.ts}`. Append it to the `ignore:` list, create the list (or the file) if it is missing, and keep every other key and comment as it was. The entry covers that rule in that whole file, not one line. From then on the audit does not report it, and `npx leanprompt@0.1.0-dev.14 score` leaves it out of the static score (as does `leanprompt calibrate`); the measured score is unaffected, because it reads the usage log, not the findings. The user undoes it by deleting the line. Tell the user which line you added.

Present each open question (a finding in `"<external>"` or with `status: "needs-facts"`) in its place in the ranking, marked as an open question: say where it lives, the tokens it would lose with the kind of that number, and its `confirm` text as the question to settle. If the user gives the fact and it confirms the finding, drop `status` and go on with the four choices; if it dismisses the finding, remove it from `.leanprompt/findings.json` and rescore; if the user does not know yet, leave it open: it stays in the score and in the report's "Open questions".

A finding marked `frequency-unknown` is a finding, not a question: present it with the four choices, and say that the code shows the problem and only how often it happens is assumed, with its `confirm` text as the way to measure it. A `size-unknown` finding is presented the same way: the code shows the problem and how often, and only the tokens it costs each time are assumed.

A finding the project already knows about (`known`) is not presented as new. For planned, in-progress or reported work, say so with the link, give its estimate, and ask whether the user wants to help with the existing issue rather than starting a new one. A declined finding is mentioned only as "declined by the project" with the link; do not propose its fix.

Present the questions for the server's administrator (`fix_by: "server"`) after the app's findings, as questions, not defects: what the server would need to have, what would answer it (for an LM Warden server, `npx leanprompt@0.1.0-dev.14 profile detect --lmwarden <url>`), and that they are not in the app's score. The user may be the administrator, or may pass them on; do not offer to change the app's code for them.

After the findings, present the notes (problems outside the rules) one at a time the same way, with `fix now`, `explain more` and `skip`. They are not scored, so a fixed note changes no score; remove it from `notes` once it is fixed.

Accept a short answer: the choice's words, its number, or "yes" for `fix now`. After the last finding, say what changed: fixed, skipped and ignored counts, and the new score with its kind.

## Asking questions

When you have your own question tool, use it: in Claude Code, the option prompts of its question tool (`AskUserQuestion`), which show the choices as options the user picks from. Without one, write numbered choices in text, one per line, and accept the number or the words as the answer. Ask one question at a time.

If you cannot ask (an unattended run, a subagent, CI), do not guess an answer and do not wait for one: use what `leanprompt.yaml` says, leave the rest unset, and let `npx leanprompt@0.1.0-dev.14 report --md` list each open question under "Questions for the owner". Say in the summary that the run was unattended.

Ask only what the code cannot answer. Read everything you can first: the SDK, the base URL, the model names, the launch files, `leanprompt.yaml`. The questions that are usually left:

- **The priority** (cost, speed or quality, or weights), when `leanprompt.yaml` is absent or has no `priority`. It decides the order of the advice; caching applies whatever the answer.
- **Whether a reorder may change answers,** before a fix that moves content (LP-PC-02, LP-PC-07, or LP-PC-03 when a value moves to a later message). Moving a date away from the text that refers to it is the known failure (E6). Say what would move and where.
- **Whether a trim may cut something the model needs,** before a fix that removes content (an `LP-PD-*` finding: a tool, an instruction, part of a tool result, old turns). Say what would be removed and from which calls, that the fix ships only after an answer check, and, when it touches the cached head, what the one-time cache loss is. Stripping reasoning from history is the known failure here (E11).
- **The provider or model,** only when the code reads it from the environment at run time and nothing else names it.

Offer to save each answer to `leanprompt.yaml` so it is never asked twice: show the lines that would be written (the priority under `priority:`, the provider or engine under `target:`, or one entry per backend under `targets:` when the app calls more than one, [docs/profile.md](../leanprompt/facts/docs/profile.md)) and write them only on a yes. Answering a question is not consent to writing the file; if the user declines, keep the answer for this session only. The file accepts only `target` (or `targets`), `engine`, `priority`, `ignore`, `volume` and `prices`, and any other key makes leanprompt stop with `unknown key`, so do not add keys of your own. A "no, the order matters" to a reorder question can be saved, on the same offer, as an `ignore:` entry for that rule and file, so the content stays where it is. A "yes" needs no entry: the fix is made, with its answer check, and the finding is gone.

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

After the last finding, if one fix now has a measured before and after, or a rule misled the user, add one line offering to share it as a "lesson learned": "If you like, `npx leanprompt@0.1.0-dev.14 lesson` drafts a short, general-terms write-up on your machine. You read the exact text and open the GitHub issue yourself; nothing is sent." The user reads the exact text and opens the issue themselves. Offer it once and accept a no. Run `npx leanprompt@0.1.0-dev.14 lesson --rule <id>` only after the user says yes, then point them at `.leanprompt/lesson.md` and the link it prints. Do not offer it for a static score alone, and never paste anything the user removed from the draft. A maintainer reads every submission before it informs a rule; credit is optional ([THANKYOU.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.14/docs/THANKYOU.md)).

## The page, the hand-off and sharing

After the summary, run `npx leanprompt@0.1.0-dev.14 report --html` and give the user the path it prints. It writes one local, self-contained page, `.leanprompt/report.html`, for the person who reads the audit rather than the conversation: a plain-English headline, what the findings cost (in money only when `leanprompt.yaml` has a volume and a dated price), one card per finding built from its `problem`, `change`, `why`, `estimate`, `assumptions` and `verify`, then the score. Write those fields for every finding: the page is only as clear as they are. When there are more than 10 findings, or the user wants to share the result, point at the page first.

The page's "Fix it with your coding agent" block is for a user who reads the page later, or in another tool: it is self-contained instructions (install leanprompt if it is missing, read the findings, check each against the code, fix one at a time with the user's yes, prove each with `measure-loop`) and the list of findings. If you are already going through the findings with the user, say so and carry on; the block is for a fresh session.

The page asks for a star or a word to a colleague only after it has shown an estimate or a measured score, and offers the README badge only when the repository's remote is on GitHub, GitLab.com or Bitbucket. Do not ask for either yourself. The Markdown report, `leanprompt-report.md`, stays the record either way.

## Auditing someone else's repository

When the repository is not the user's (an open-source project, a client's code, a clone made only to audit it), leave it as you found it:

- **Install outside it.** Install the skills for all your projects (`npx leanprompt@0.1.0-dev.14 install --scope=global`) instead of into the repository's `.claude/` or `.agents/`, which may already hold the author's own agent files. If they must go in the project, tell the user which folders were added.
- **A private npm registry.** A repository whose `.npmrc` points `registry=` at a private feed (common in company repositories) makes `npx leanprompt@0.1.0-dev.14` fail with a 404 from that feed. Run it with the public registry for that one call (`npm_config_registry=https://registry.npmjs.org/ npx leanprompt@<version> install --scope=global`), or run every `npx leanprompt@0.1.0-dev.14` command from outside the repository: install with `--scope=global`, and give `score` and `report` the repository with `--dir <path>`.
- **Keep the audit's files out of its history.** `leanprompt-report.md` and `.leanprompt/` are the user's notes, not a contribution. Add them to `.git/info/exclude` (local to this clone, not committed) or keep the clone separate from any checkout used for a pull request, and never commit them to someone else's repository.
- **Read its contribution policy before reporting upstream.** If the user wants to tell the maintainers, check first, and say what you found:
  - **AI-generated contributions.** A ban or a rule on AI-written issues or pull requests in the contribution guide, the README, the code of conduct or the templates. Some projects close any pull request with an agent signature, or ask for a disclosure; some forbid AI-written issues altogether. If AI-written reports are banned, do not post; tell the user.
  - **A contributor licence agreement (CLA).** A CLA bot or a CLA section in the guide means a pull request needs the user's signature first.
  - **Issue first.** Many projects want an issue before a pull request (or before a large one).
  - **Labels reserved for the core team.** An issue labelled `core-team-only` (or similar) is not open for outside pull requests; comment on it instead.
  - Which branch pull requests go to (`dev`, `main`), and how outside contributions have been treated lately (merged, closed, unanswered), so the user knows what to expect.
- **One complete post.** Report one verified problem (the one with the clearest fix, with related findings folded in only when one fix covers them), in one issue, complete on its own: what happens with file and line links pinned to the commit read, why it costs, the fix, how to check it, and the figures labelled as estimates. Do not promise follow-ups or offer more findings ("I can send the rest", "happy to open a PR"): the maintainers can ask. Do not open a pull request unless they ask for one. End with one disclosure line: that the audit used leanprompt and an AI assistant, with a link. Never paste the whole report into an issue, and leave out what the project has declined.
<!-- leanprompt:generated v0.1.0-dev.14: written by npx leanprompt install; npx leanprompt update replaces local edits -->
