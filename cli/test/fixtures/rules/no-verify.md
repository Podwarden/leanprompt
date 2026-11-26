---
id: LP-PC-02
title: Fixture rule
skill: prefill-cache
applies_to: [anthropic, openai]
saves: prefill
severity: high
evidence: [E3]
---
## Rule
Keep the stable head first.

## Why
Prefix caches match from the first token.

## Detect in code
grep for f-strings in system prompts.

## Fix
Move volatile text after the stable head.

## Don't break meaning
Keep a date next to the text that refers to it.

## Waste signal
Share of prompt tokens lost.
