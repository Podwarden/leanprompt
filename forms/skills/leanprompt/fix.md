# /leanprompt fix

Works through the open findings in `.leanprompt/findings.json`, largest first. With a target (a rule id or a file), only the findings that match it. If there is no findings file, say so and offer `/leanprompt audit` first.

These are the same hand-off rules as the "Fix it with your coding agent" block on the report page:

1. **Check each finding against the code first.** Open the file and line, read the rule's "Detect in code", and confirm the finding still holds. The audit can be wrong, and code changes after it. If it does not hold, say why, leave the code alone, and offer to remove the finding from the file.
2. **One finding at a time.** Present it as a decision with the four choices in [presenting.md](../llm-call-audit/presenting.md#one-finding-at-a-time): `fix now`, `explain more`, `skip`, `don't flag this again`.
3. **Show the diff.** One fix per finding, the smallest one in the rule's "Fix", as a small diff ([presenting.md](../llm-call-audit/presenting.md#fixes-and-proofs)). Before a fix that moves or removes content, ask the reorder or trim question first.
4. **Apply only on a yes.** A yes covers that one diff, nothing more.
5. **Prove it.** Hand the fix to [measure-loop](../measure-loop/SKILL.md): a before and after on the same scenario. Ask before running anything that sends billed requests. A fix that can change answers needs its answer check to pass first.
6. **Record it.** When a fix is proved, set `"fixed": true` on its finding and run `npx leanprompt@0.1.0-dev.15 score` again.

After the last finding, say what changed: fixed, skipped and ignored counts, and the new score with its kind.
<!-- leanprompt:generated v0.1.0-dev.15: written by npx leanprompt install; npx leanprompt update replaces local edits -->
