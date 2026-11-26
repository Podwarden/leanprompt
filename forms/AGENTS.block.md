<!-- leanprompt:begin -->
## leanprompt

Skills that get more from every LLM call: cacheable prompts, no dead weight, no wasted output.
Load a skill only
when its task comes up, and a rule file only when the skill points at it.

Skills live in `.claude/skills/<name>/` or `.agents/skills/<name>/` (Cursor: `.cursor/rules/leanprompt-<name>.mdc`):

- `llm-call-audit`: audit an app's LLM calls, rank the waste, write the report and findings
- `prefill-cache`: rules for prompts the provider's cache can reuse (LP-PC-*)
- `generation-economy`: rules for calls and output that are not wasted (LP-GE-*)
- `prompt-diet`: rules that cut dead weight from what each call sends (LP-PD-*)
- `measure-loop`: prove a fix with a before and after number; the score (CI test, logger)
- `lmwarden`: rules for self-hosted vLLM, SGLang and LM Warden servers (LP-LW-*)

- Start with `llm-call-audit` for "where do this app's LLM calls lose tokens or time".
- Rules are in `<skill>/rules/LP-*.md`. Each ends with `Verify`; run it before calling a fix done.
- Provider and model facts (limits, minimums, TTLs) are in the `providers/` and `models/`
  pages linked from each rule, and HTTP client defaults in `runtimes/`, each with a `checked:`
  date. Do not quote them from memory.
- Ask before editing code, installing a package, or running anything that sends billed requests.
- Keep meaning: a fix that changes what the model is asked or answers is not a fix.
<!-- leanprompt:end -->
