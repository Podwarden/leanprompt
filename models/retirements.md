---
family: retirements
checked: 2026-11-27
source: https://developers.openai.com/api/docs/deprecations
---

# Model retirements

Status: documented, from the three providers' official pages, read on 2026-11-27. Used by the rule on retired default models. Status is "retired" when the listed shutdown date is before 2026-11-27 and "scheduled" when it is on or after that date. Dates are the ones the pages give. Page text was read through a summarising fetch tool, so re-check a row against the page before relying on it for a decision. Pages read: https://developers.openai.com/api/docs/deprecations ; https://platform.claude.com/docs/en/about-claude/model-deprecations ; https://aistudio.google.com/docs/deprecations (the requested https://ai.google.dev/gemini-api/docs/deprecations answered 301 to this address).

## Snapshot and alias

- OpenAI (read 2026-11-27): the page states no general policy on aliases versus dated snapshots. It lists them together, often on one row with one date. It says `gpt-4-turbo-preview` and `gpt-4-turbo-preview-completions` "point to this snapshot" (gpt-4-0125-preview). It says fine-tuned versions "follow the same shutdown schedule as their underlying base models". The bare ids `gpt-4o` and `gpt-4o-mini` do not appear in the page's tables; only dated snapshots do (see the OpenAI table). The page says nothing about what happens to the bare id on those dates: not stated on the page.
- Anthropic (read 2026-11-27): the page says "This retirement includes `claude-sonnet-4-5`, the same model's ID without a date" (and the same for `claude-opus-4-5`). For other models the alias is not mentioned: not stated on the page.
- Google Gemini API (read 2026-11-27): the page gives no general rule for aliases versus versioned ids: not stated on the page. It lists `gemini-2.0-flash` and `gemini-2.0-flash-001` as separate rows with the same date. For `gemini-3.7-flash` and `gemini-3.5-flash` it says the model is no longer available in Google AI Studio and "the endpoint is not shutting down and automatically routes API requests to" the replacement. For `gemini-2.5-pro` and `gemini-2.5-flash` it says that effective 2026-12-01 requests "will automatically route to" a replacement model. So on Google an id can be repointed instead of erroring. It also says listed shutdown dates "indicate the earliest possible dates" a model might be retired.

## OpenAI

Source page read 2026-11-27. The page's "Upcoming" and "Past" sections are both included; one row per model id. Cyber, codex, search-preview and other specialised ids are included where the page lists them.

| Model id | Status | Shutdown date | Replacement | Source |
|---|---|---|---|---|
| `gpt-5` | scheduled | 2026-12-11 | gpt-6.1-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5-2025-08-07` | scheduled | 2026-12-11 | gpt-6.1-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5-mini` | scheduled | 2026-12-11 | gpt-6.1-terra | https://developers.openai.com/api/docs/deprecations |
| `gpt-5-mini-2025-08-07` | scheduled | 2026-12-11 | gpt-6.1-terra | https://developers.openai.com/api/docs/deprecations |
| `gpt-5-nano` | scheduled | 2026-12-11 | gpt-6-luna | https://developers.openai.com/api/docs/deprecations |
| `gpt-5-nano-2025-08-07` | scheduled | 2026-12-11 | gpt-6-luna | https://developers.openai.com/api/docs/deprecations |
| `gpt-5-pro` | scheduled | 2026-12-11 | gpt-6.1-sol (reasoning.mode: pro) in Responses API | https://developers.openai.com/api/docs/deprecations |
| `gpt-5-pro-2025-10-06` | scheduled | 2026-12-11 | gpt-6.1-sol (reasoning.mode: pro) in Responses API | https://developers.openai.com/api/docs/deprecations |
| `o3` | scheduled | 2026-12-11 | gpt-6.1-sol | https://developers.openai.com/api/docs/deprecations |
| `o3-2025-04-16` | scheduled | 2026-12-11 | gpt-6.1-sol | https://developers.openai.com/api/docs/deprecations |
| `o3-pro` | scheduled | 2026-12-11 | gpt-6.1-sol (reasoning.mode: pro) in Responses API | https://developers.openai.com/api/docs/deprecations |
| `o3-pro-2025-06-10` | scheduled | 2026-12-11 | gpt-6.1-sol (reasoning.mode: pro) in Responses API | https://developers.openai.com/api/docs/deprecations |
| `gpt-4o-2024-08-06` | scheduled | 2027-01-14 | gpt-6-luna | https://developers.openai.com/api/docs/deprecations |
| `gpt-4o-2024-11-20` | scheduled | 2027-01-14 | gpt-6-luna | https://developers.openai.com/api/docs/deprecations |
| `gpt-4o-mini-2024-07-18` | scheduled | 2027-01-14 | gpt-6-luna | https://developers.openai.com/api/docs/deprecations |
| `gpt-4.1-2025-04-14` | scheduled | 2027-01-14 | gpt-6-luna | https://developers.openai.com/api/docs/deprecations |
| `gpt-4.1-mini-2025-04-14` | scheduled | 2027-01-14 | gpt-6-luna | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.5-cyber-preview` | scheduled | 2027-02-01 | not named on the page | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.3-codex` | scheduled | 2027-04-01 | gpt-6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.4-nano` | scheduled | 2027-04-01 | gpt-6-luna | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.4-nano-2026-03-17` | scheduled | 2027-04-01 | gpt-6-luna | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.1` | scheduled | 2027-04-01 | gpt-6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.1-2025-11-13` | scheduled | 2027-04-01 | gpt-6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-3.5-turbo-0125` | retired | 2026-10-23 | gpt-5.6-terra | https://developers.openai.com/api/docs/deprecations |
| `gpt-3.5-turbo` | retired | 2026-10-23 | gpt-5.6-terra | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-0613` | retired | 2026-10-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-4` | retired | 2026-10-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-1106-preview` | retired | 2026-10-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-turbo` | retired | 2026-10-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-turbo-2024-04-09` | retired | 2026-10-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-4o-2024-05-13` | retired | 2026-10-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `o1-2024-12-17` | retired | 2026-10-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `o1` | retired | 2026-10-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `o3-mini-2025-01-31` | retired | 2026-10-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `o3-mini` | retired | 2026-10-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-4.1-nano` | retired | 2026-10-23 | gpt-5.6-luna | https://developers.openai.com/api/docs/deprecations |
| `gpt-4.1-nano-2025-04-14` | retired | 2026-10-23 | gpt-5.6-luna | https://developers.openai.com/api/docs/deprecations |
| `o1-pro-2025-03-19` | retired | 2026-10-23 | gpt-5.6-sol (reasoning.mode: pro) | https://developers.openai.com/api/docs/deprecations |
| `o1-pro` | retired | 2026-10-23 | gpt-5.6-sol (reasoning.mode: pro) | https://developers.openai.com/api/docs/deprecations |
| `o4-mini-2025-04-16` | retired | 2026-10-23 | gpt-5.6-terra | https://developers.openai.com/api/docs/deprecations |
| `o4-mini` | retired | 2026-10-23 | gpt-5.6-terra | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.4-cyber` | retired | 2026-10-01 | not named on the page | https://developers.openai.com/api/docs/deprecations |
| `gpt-3.5-turbo-1106` | retired | 2026-09-28 | gpt-5.6-terra | https://developers.openai.com/api/docs/deprecations |
| `gpt-3.5-turbo-instruct` | retired | 2026-09-28 | gpt-5.6-terra | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.2-chat-latest` | retired | 2026-08-10 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.3-chat-latest` | retired | 2026-08-10 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5-chat-latest` | retired | 2026-07-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5-codex` | retired | 2026-07-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.1-chat-latest` | retired | 2026-07-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.1-codex` | retired | 2026-07-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.1-codex-max` | retired | 2026-07-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.2-codex` | retired | 2026-07-23 | gpt-5.6-sol | https://developers.openai.com/api/docs/deprecations |
| `gpt-5.1-codex-mini` | retired | 2026-07-23 | gpt-5.6-terra | https://developers.openai.com/api/docs/deprecations |
| `gpt-4o-mini-search-preview-2025-03-11` | retired | 2026-07-23 | gpt-5.6-terra | https://developers.openai.com/api/docs/deprecations |
| `gpt-4o-search-preview-2025-03-11` | retired | 2026-07-23 | gpt-5.6-terra | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-0314` | retired | 2026-03-26 | gpt-5, or gpt-4.1 for latency-sensitive tasks not requiring reasoning | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-0125-preview` | retired | 2026-03-26 | gpt-5, or gpt-4.1 for latency-sensitive tasks not requiring reasoning | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-turbo-preview` | retired | 2026-03-26 | gpt-5, or gpt-4.1 for latency-sensitive tasks not requiring reasoning | https://developers.openai.com/api/docs/deprecations |
| `chatgpt-4o-latest` | retired | 2026-02-17 | gpt-5.1-chat-latest | https://developers.openai.com/api/docs/deprecations |
| `codex-mini-latest` | retired | 2026-02-12 | gpt-5-codex-mini | https://developers.openai.com/api/docs/deprecations |
| `o1-mini` | retired | 2025-10-27 | o4-mini | https://developers.openai.com/api/docs/deprecations |
| `o1-preview` | retired | 2025-07-28 | o3 | https://developers.openai.com/api/docs/deprecations |
| `gpt-4.5-preview` | retired | 2025-07-14 | gpt-4.1 | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-32k` | retired | 2025-06-06 | gpt-4o | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-32k-0613` | retired | 2025-06-06 | gpt-4o | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-vision-preview` | retired | 2024-12-06 | gpt-4o | https://developers.openai.com/api/docs/deprecations |
| `gpt-4-1106-vision-preview` | retired | 2024-12-06 | gpt-4o | https://developers.openai.com/api/docs/deprecations |

## OpenAI image and embedding models

Rows read from the same OpenAI page on 2026-11-27 (checked against the raw page text, not a summary), for an app that sends an image or embedding model id. The page lists no shutdown for `text-embedding-ada-002` or the `text-embedding-3-*` models; older embedding ids (`text-similarity-*`, `text-search-*`) were shut down on 2024-01-04 with `text-embedding-3-small` as the replacement.

| Model id | Status | Shutdown date | Replacement | Source |
|---|---|---|---|---|
| `dall-e-2` | retired | 2026-05-12 | gpt-image-2, gpt-image-1 or gpt-image-1-mini | https://developers.openai.com/api/docs/deprecations |
| `dall-e-3` | retired | 2026-05-12 | gpt-image-2, gpt-image-1 or gpt-image-1-mini | https://developers.openai.com/api/docs/deprecations |

## Anthropic

Source page read 2026-11-27. On Anthropic-operated platforms only; the page says Amazon Bedrock and Google-managed Claude set their own schedules. The page's status table also lists active models (not in this table). `claude-mythos-preview` is "Deprecated" (2026-06-09) with retirement "To be announced", so it has no row here.

| Model id | Status | Shutdown date | Replacement | Source |
|---|---|---|---|---|
| `claude-opus-4-5-20251101` | scheduled | 2027-01-22 | claude-opus-5-5 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-opus-4-5` | scheduled | 2027-01-22 | claude-opus-5-5 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-sonnet-4-5-20250929` | scheduled | 2026-11-30 | claude-sonnet-5-5 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-sonnet-4-5` | scheduled | 2026-11-30 | claude-sonnet-5-5 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-opus-4-1-20250805` | retired | 2026-08-05 | claude-opus-4-8 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-sonnet-4-20250514` | retired | 2026-06-15 | claude-sonnet-5-5 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-opus-4-20250514` | retired | 2026-06-15 | claude-opus-4-8 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-3-haiku-20240307` | retired | 2026-04-20 | claude-haiku-4-5-20251001 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-3-5-haiku-20241022` | retired | 2026-02-19 | claude-haiku-4-5-20251001 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-3-7-sonnet-20250219` | retired | 2026-02-19 | claude-sonnet-5-5 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-3-opus-20240229` | retired | 2026-01-05 | claude-opus-4-8 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-3-5-sonnet-20240620` | retired | 2025-10-28 | claude-sonnet-5-5 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-3-5-sonnet-20241022` | retired | 2025-10-28 | claude-sonnet-5-5 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-2.0` | retired | 2025-07-21 | claude-opus-4-8 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-2.1` | retired | 2025-07-21 | claude-opus-4-8 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-3-sonnet-20240229` | retired | 2025-07-21 | claude-sonnet-5-5 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-1.0` | retired | 2024-11-06 | claude-haiku-4-5-20251001 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-1.1` | retired | 2024-11-06 | claude-haiku-4-5-20251001 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-1.2` | retired | 2024-11-06 | claude-haiku-4-5-20251001 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-1.3` | retired | 2024-11-06 | claude-haiku-4-5-20251001 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-instant-1.0` | retired | 2024-11-06 | claude-haiku-4-5-20251001 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-instant-1.1` | retired | 2024-11-06 | claude-haiku-4-5-20251001 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| `claude-instant-1.2` | retired | 2024-11-06 | claude-haiku-4-5-20251001 | https://platform.claude.com/docs/en/about-claude/model-deprecations |

## Google Gemini API

Source page read 2026-11-27 (aistudio.google.com/docs/deprecations). The page lists no Gemini 1.0 or 1.5 text models. The page lists `gemini-2.5-flash-lite` as not deprecated, with no shutdown date announced, so it has no row. Newer ids (gemini-3.x and gemini-4 families) with no shutdown date are not listed.

| Model id | Status | Shutdown date | Replacement | Source |
|---|---|---|---|---|
| `gemini-3.1-flash-lite` | scheduled | 2027-05-07 | gemini-3.5-flash-lite | https://aistudio.google.com/docs/deprecations |
| `gemini-2.5-pro` | scheduled | 2026-12-01 | gemini-3.8-flash | https://aistudio.google.com/docs/deprecations |
| `gemini-2.5-flash` | scheduled | 2026-12-01 | gemini-3.5-flash-lite | https://aistudio.google.com/docs/deprecations |
| `gemini-2.5-computer-use-preview-10-2025` | retired | 2026-07-28 | gemini-3.8-flash | https://aistudio.google.com/docs/deprecations |
| `gemini-3.1-flash-lite-preview` | retired | 2026-05-25 | gemini-3.1-flash-lite | https://aistudio.google.com/docs/deprecations |
| `gemini-3-pro-preview` | retired | 2026-03-09 | gemini-3.1-pro-preview | https://aistudio.google.com/docs/deprecations |
| `gemini-2.0-flash` | retired | 2026-06-01 | gemini-3.6-flash | https://aistudio.google.com/docs/deprecations |
| `gemini-2.0-flash-001` | retired | 2026-06-01 | gemini-3.6-flash | https://aistudio.google.com/docs/deprecations |
| `gemini-2.0-flash-lite` | retired | 2026-06-01 | gemini-3.1-flash-lite | https://aistudio.google.com/docs/deprecations |
| `gemini-2.0-flash-lite-001` | retired | 2026-06-01 | gemini-3.1-flash-lite | https://aistudio.google.com/docs/deprecations |
| `gemini-2.5-flash-lite-preview-09-2025` | retired | 2026-03-31 | gemini-3.1-flash-lite | https://aistudio.google.com/docs/deprecations |
| `gemini-2.5-flash-preview-09-2025` | retired | 2026-02-17 | gemini-3.6-flash | https://aistudio.google.com/docs/deprecations |
| `gemini-2.5-pro-preview-03-25` | retired | 2025-12-02 | gemini-3.8-flash | https://aistudio.google.com/docs/deprecations |
| `gemini-2.5-pro-preview-05-06` | retired | 2025-12-02 | gemini-3.8-flash | https://aistudio.google.com/docs/deprecations |
| `gemini-2.5-pro-preview-06-05` | retired | 2025-12-02 | gemini-3.8-flash | https://aistudio.google.com/docs/deprecations |
| `gemini-2.0-flash-lite-preview` | retired | 2025-12-09 | gemini-3.1-flash-lite | https://aistudio.google.com/docs/deprecations |
| `gemini-2.0-flash-lite-preview-02-05` | retired | 2025-12-09 | gemini-3.1-flash-lite | https://aistudio.google.com/docs/deprecations |
| `gemini-2.5-flash-preview-05-20` | retired | 2025-11-18 | gemini-3.6-flash | https://aistudio.google.com/docs/deprecations |
| `gemini-3.7-flash` | deprecated, no date | none (page: not shutting down) | gemini-3.8-flash | https://aistudio.google.com/docs/deprecations |
| `gemini-3.5-flash` | deprecated, no date | none (page: not shutting down) | gemini-3.6-flash | https://aistudio.google.com/docs/deprecations |

## Not stated on these pages

- OpenAI: what a request to a retired id returns, and whether a bare alias is repointed or errors when its dated snapshot retires: not stated on the page (read 2026-11-27).
- Anthropic: the page states that requests to retired models fail and that the Messages API returns a 404 `not_found_error` on the Claude API (read 2026-11-27). Whether the bare ids of models other than Sonnet 4.5 and Opus 4.5 retire with their dated ids is not stated.
- Google: whether the routing described for `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.7-flash` and `gemini-3.5-flash` also applies to retired ids such as `gemini-2.0-flash` after 2026-06-01 is not stated on the page; the page also says dates are the earliest possible.
- Pricing or behaviour differences between a retired model and its listed replacement: not stated.
- Whether any model was retired earlier or later than its listed date: not stated.

## DeepSeek and others

Other providers are not in this table; check their own pages (for example DeepSeek's news/pricing page) and record the date read.
