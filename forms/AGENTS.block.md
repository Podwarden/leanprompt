<!-- leanprompt:begin -->
## leanprompt

Skills that cut wasted prefill and generation in code that calls LLMs. Load a skill only
when its task comes up, and a rule file only when the skill points at it.

Skills live in `.claude/skills/<name>/` or `.agents/skills/<name>/` (Cursor: `.cursor/rules/leanprompt-<name>.mdc`):

- `llm-call-audit`: audit an app's LLM calls, rank the waste, write the report and findings
- `prefill-cache`: rules for prompts the provider's cache can reuse (LP-PC-*)
- `generation-economy`: rules for calls and output that are not wasted (LP-GE-*)
- `measure-loop`: prove a fix with a before and after number; the score (CI test, logger)
- `lmwarden`: rules for self-hosted vLLM, SGLang and LM Warden servers (LP-LW-*)

- Start with `llm-call-audit` for "where does this app pay for the same tokens twice".
- Rules are in `<skill>/rules/LP-*.md`. Each ends with `Verify`; run it before calling a fix done.
- Provider and model facts (limits, minimums, TTLs) are in the `providers/` and `models/`
  pages linked from each rule, each with a `checked:` date. Do not quote them from memory.
- Ask before editing code, installing a package, or running anything that sends billed requests.
- Keep meaning: a fix that changes what the model is asked or answers is not a fix.
<!-- leanprompt:end -->
