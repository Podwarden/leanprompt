---
id: LP-GE-13
title: Default to a model the provider still serves
skill: generation-economy
applies_to: [anthropic, openai, gemini, deepseek, groq, xai, together, any]
saves: none
severity: high
evidence:
  - doc: https://developers.openai.com/api/docs/deprecations
    checked: 2026-11-27
  - doc: https://platform.claude.com/docs/en/about-claude/model-deprecations
    checked: 2026-11-27
  - doc: https://aistudio.google.com/docs/deprecations
    checked: 2026-11-27
---
## Rule
Every model id the app ships as a default (in code, config files, environment templates, the README's setup steps) must be one the provider still serves, and not one with a shutdown date inside the app's next release cycle; check each id against [models/retirements.md](../../leanprompt/facts/models/retirements.md) and the provider's own page.

## Why
Providers retire models on published dates. After that date a request to a retired id fails (Anthropic: HTTP 404 `not_found_error`) or is silently routed to another model (Google states that some ids "automatically route" to a replacement; xAI redirects several retired grok ids, [providers/xai.md](../../leanprompt/facts/providers/xai.md)). Either way the default the app ships no longer does what its author tested: every new install fails on first use, or runs a different model at a different price.

A dated snapshot and a bare alias are different ids and can retire on different dates. OpenAI's page lists dated snapshots (`gpt-4o-mini-2024-07-18`) and says nothing about the bare alias; Anthropic retires some aliases together with their dated id and says so per model; Google lists both forms as separate rows ([models/retirements.md](../../leanprompt/facts/models/retirements.md), "Snapshot and alias"). Match the exact id the code sends, and when only the other form is listed, say so instead of assuming.

This is a correctness rule: a retired default wastes no tokens (a failed call is not billed), so it has no token share, and the audit records a match as a note that names this rule. The target the code implies is then not a real target: say so in the audit's inventory instead of scoring against it.

## Detect in code
Check every model id the app can send, not only the chat default: image, embedding, speech and moderation models too, ids in model picker lists, and ids in README, compose and `.env.example` examples. Find model-id string literals where they live: config modules, settings classes, CLI option defaults, `.env.example`, Docker and compose files, the README's quick start, docs with cron or shell recipes, the lists a settings page offers. Keep three kinds apart in the note: the default the app sends with no configuration, ids that are only selectable (a picker entry, an enum), and ids that appear only in docs. A host can also drop a whole category (a provider that no longer serves embedding models on its serverless tier); read its table.

Python:
```
rg -n "(model|MODEL)\s*[:=]\s*['\"][A-Za-z0-9./:_-]+['\"]" -g '*.py' -g '*.toml' -g '*.yaml' -g '*.yml' -g '*.env*'
rg -n 'gpt-[0-9]|o[134]-|claude-|gemini-|deepseek-|grok-|llama-|qwen' -g '*.py'
```
TS/JS:
```
rg -n "(model|MODEL)\w*\s*[:=]\s*['\"\`][A-Za-z0-9./:_-]+['\"\`]" -g '*.{ts,tsx,js,mjs,json}'
rg -n 'gpt-[0-9]|claude-|gemini-|deepseek-|grok-' -g '*.{ts,tsx,js,mjs,json}' -g '*.md'
```
Go:
```
rg -n 'Model\s*[:=]\s*"|"(gpt|claude|gemini|deepseek|grok)-' -g '*.go'
```
Shapes: `DEFAULT_MODEL = "claude-3-5-sonnet-20241022"`; `model: config.model ?? "gpt-4o-mini"`; a provider-prefixed id (`openai:gpt-4o-mini`, `anthropic/claude-3-haiku`) whose part after the prefix is listed; a README example that names a retired id. Strip a router prefix (`openai/`, `openrouter/`) before matching, and record which provider's page decided it.

For each id found, look it up in [models/retirements.md](../../leanprompt/facts/models/retirements.md). For a provider not in that table, read its own page ([providers/deepseek.md](../../leanprompt/facts/providers/deepseek.md), [providers/groq.md](../../leanprompt/facts/providers/groq.md), [providers/together.md](../../leanprompt/facts/providers/together.md), [providers/xai.md](../../leanprompt/facts/providers/xai.md) list what their pages state) and record the date read.

Not a finding: an id only in a changelog, a test fixture that never calls the provider, or a migration note that names the old id on purpose.

## Fix
```python
# before
DEFAULT_MODEL = "gpt-4o-mini-2024-07-18"     # shutdown 2027-01-14 (models/retirements.md)

# after: the replacement the provider lists, chosen by the owner, and one place to change it
DEFAULT_MODEL = settings.get("model", "<replacement the provider lists>")
```

Name the replacement the provider's page lists, but leave the choice to the owner: a new model can change answers, prices and limits (LP-GE-03's budgets, the prompt cache minimum). Keep the default in one place, so the next retirement is a one-line change.

## Don't break meaning
A model change can change answers. Run the app's answer check (or a small fixed set of inputs) on the new default before and after. Keep the user's own `MODEL` setting winning over the default.

## Verify
(a) Provider: one request with the shipped default and no overrides succeeds (a `finish_reason` or `stop_reason`, not an error) and reports the model id the app expects in the response's `model` field (a redirected id shows a different one).

(b) leanprompt usage record: every record's `model` is the configured default or an override, never a retired id, and no record has `finish` set to an error on first use.

## Waste signal
No token share: a failed call is not billed, so it never enters the score. The audit records a match as a note with `"rule": "LP-GE-13"` and a severity. High: the default the app ships (chat, image or embedding) is already retired, or is silently redirected to another model. Medium: the default has a published shutdown date within about six months of the audit; selectable ids (picker entries) that are already retired; a README or compose example that names a retired id (label it docs only). Low: a shutdown date further out, or an id listed as deprecated with no date. Give the id, the page, its date and the date read in the note.
<!-- leanprompt:generated v0.1.0-dev.15: written by npx leanprompt install; npx leanprompt update replaces local edits -->
