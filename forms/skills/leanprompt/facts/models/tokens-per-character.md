---
family: tokens-per-character
checked: 2026-11-27
source: https://www.un.org/en/about-us/universal-declaration-of-human-rights
---

# Tokens per character by language

Status: measured here on 2026-11-27 with the tokenizers named below, on one short sample per language; a rough guide for sizing output limits, not a provider fact.

## Method

- Sample: Articles 1 to 3 of the Universal Declaration of Human Rights (article headings removed, text joined into one string), in English, Chinese (Simplified), Russian, Arabic, Spanish, Japanese, Korean and German. The OHCHR translation pages (https://www.ohchr.org/en/human-rights/universal-declaration/translations) returned HTTP 403 to automated fetches, so the texts came from the UN's own page for the five UN languages and from the OHCHR translation PDFs for the other three (URLs in the table).
- Hindi was dropped: the OHCHR page returned 403 and its Hindi PDF (https://www.ohchr.org/sites/default/files/UDHR/Documents/UDHR_Translations/hnd.pdf) is a scanned image with no text layer. Arabic uses the UN page.
- Characters: Unicode code points (Python `len()`) after stripping leading and trailing whitespace. In the PDF texts, line breaks were joined with a space (Korean, German) or removed (Japanese), so stray spacing from the PDF extraction is in the Korean sample.
- Tokens: `cl100k_base` and `o200k_base` via tiktoken 0.14.0; `Qwen/Qwen2.5-7B-Instruct` and `deepseek-ai/DeepSeek-V3` via tokenizers 0.23.3 (tokenizer.json only, huggingface_hub 2.5.0), special tokens not added.
- Cells show tokens per character, then characters per token in parentheses, two decimals.

| Language | Characters | cl100k_base tokens/char | o200k_base tokens/char | Qwen2.5 tokens/char | DeepSeek-V3 tokens/char | Sample source |
|---|---|---|---|---|---|---|
| English | 751 | 0.19 (5.14) | 0.19 (5.14) | 0.19 (5.14) | 0.19 (5.18) | https://www.un.org/en/about-us/universal-declaration-of-human-rights |
| Chinese (Simplified) | 210 | 1.11 (0.90) | 0.80 (1.25) | 0.61 (1.64) | 0.60 (1.67) | https://www.un.org/zh/about-us/universal-declaration-of-human-rights |
| Japanese | 341 | 1.13 (0.88) | 0.84 (1.19) | 0.68 (1.47) | 0.65 (1.53) | https://www.ohchr.org/sites/default/files/UDHR/Documents/UDHR_Translations/jpn.pdf |
| Korean | 380 | 1.02 (0.98) | 0.58 (1.72) | 0.63 (1.60) | 0.64 (1.56) | https://www.ohchr.org/sites/default/files/UDHR/Documents/UDHR_Translations/kkn.pdf |
| Russian | 878 | 0.45 (2.23) | 0.24 (4.20) | 0.31 (3.28) | 0.26 (3.80) | https://www.un.org/ru/about-us/universal-declaration-of-human-rights |
| Arabic | 675 | 0.72 (1.38) | 0.34 (2.92) | 0.38 (2.61) | 0.37 (2.73) | https://www.un.org/ar/about-us/universal-declaration-of-human-rights |
| Spanish | 856 | 0.25 (4.04) | 0.20 (4.92) | 0.24 (4.12) | 0.23 (4.35) | https://www.un.org/es/about-us/universal-declaration-of-human-rights |
| German | 838 | 0.26 (3.81) | 0.21 (4.79) | 0.26 (3.84) | 0.25 (3.99) | https://www.ohchr.org/sites/default/files/UDHR/Documents/UDHR_Translations/ger.pdf |

## How to use it

- Ratios vary with the text (legal prose here; code, chat and JSON differ) and with the tokenizer, so treat the table as a rough guide for sizing output limits.
- When it matters, count a real sample of the app's own text with the target model's tokenizer.
- Anthropic and Gemini models are not in the table. For those, use the provider's token-counting endpoint: the Messages `count_tokens` endpoint (https://platform.claude.com/docs/en/build-with-claude/token-counting, read 2026-11-27) and the Gemini `countTokens` method (https://ai.google.dev/gemini-api/docs/tokens, read 2026-11-27).
<!-- leanprompt:generated v0.1.0-dev.15: written by npx leanprompt install; npx leanprompt update replaces local edits -->
