---
id: LP-PC-00                 # stable; never reused. Format LP-<PC|GE|LW>-<nn>
title: Short imperative title
skill: prefill-cache         # prefill-cache | generation-economy | lmwarden
applies_to: [anthropic, openai, gemini, vllm, sglang, any-automatic]
saves: prefill               # prefill | generation | both
severity: high               # high | medium | low, by typical tokens lost
evidence: [E3]               # rows of docs/evidence.md, or {doc: <url>, checked: YYYY-MM-DD}
---
## Rule
One sentence, imperative.

## Why
The mechanism, in 3-6 lines, with the provider's render order.

## Detect in code
Grep patterns and code shapes per language (Python, TS/JS, Go first).

## Fix
A before/after snippet; the smallest change that works.

## Don't break meaning
What the fix must not do (for example: do not move a date away from the text that refers to it).

## Verify
Two ways: (a) the provider's usage field across two requests; (b) kvsig: which id must stay equal (sys, tools, nodes[i]).

## Waste signal
How the audit scores it, and the Prompt Lens cause code if one exists.
