## 2. Evidence this repo is built on

Only measured facts go into rules, the README and the launch posts. Each one
carries its source and its limits. Anonymised: no customer names, no internal
hosts, no keys.

| # | Finding | Source | Limits |
|---|---|---|---|
| E1 | Anthropic cached **0 tokens on 29 turns** of Codex and OpenCode sessions, which send no `cache_control`; kvsig predicted 247,947 reusable. The Claude Code sessions, which set 3 breakpoints, matched kvsig at 100% and 97% (435,661 of 471,607 prompt tokens cached on one). | OpenRouter test 1, 2026-11-21 (kvsig-tools report; internal, not public) | One replay per session, gaps capped at 8 s, `max_tokens` 1 |
| E2 | On automatic caches (OpenAI, DeepSeek-class on DeepInfra) kvsig prefix ids predicted provider `cached_tokens` with **95% and 96% token agreement**. OpenAI reports cached tokens as 1,024 plus multiples of 128; DeepInfra in multiples of 64. | same (internal report, not public) | Three models, four sessions |
| E3 | A tool appended **at the end** of the list kept most of the cache on automatic caches (DeepInfra cached 10,176 of 21,149 after one deferred tool was appended); on Anthropic, which renders tools first, the same change cached 0 with no breakpoint in front of it. | same (internal report, not public) | One session |
| E4 | Claude Code's first system line carries a per-session version suffix and the working directory; Anthropic still reused 12,895 tokens across sessions because it renders tools first and the tools were equal. Routes that render the system prompt first lose everything after line 1. | same (internal report, not public) | |
| E5 | OpenCode writes the working directory into its ~28k-character system prompt. Across sessions in different directories, a self-hosted vLLM reused only the 7,920 tokens before that line. | OpenCode 2.3.2 recapture, 2026-11-22 (internal report, not public) | One harness, two versions |
| E6 | Moving date lines to the end of the prompt cut correct date answers **from 10/12 to 1/12**, lowered the control question from 7/12 to 4/12, and did not help caching (median cached share 87% control, 80% moved). | Reorder experiment, 2026-11-22 (internal report, not public) | 16 items, 12 questions per arm |
| E7 | Toggling thinking on and off between turns of one session lost **47% of what those turns could have reused** (329k tokens; 9% of the whole miss). Turns with the same setting as the turn before lost nothing beyond the engine rule. The chat template renders earlier assistant turns differently by flag. | Agent-traffic investigation on a self-hosted vLLM (Qwen hybrid model), 2026-11-22 (internal report, not public) | One model family's template |
| E8 | The same synthetic agent traffic reused **45.7%** of prompt tokens in its first long run and **89.2%** in a later 30-minute run, after its agents were given realistic stable heads (15k to 25k tokens of system prompt and tool schemas instead of ~1k) and thinking was fixed per session. | Demo generator run summaries, 2026-11-22 (internal report, not public) | Synthetic; two changes at once; engine settings between the runs to be confirmed; wording not yet approved for quotation |
| E9 | On hybrid models vLLM caches in large blocks (1,584 tokens in one production setup) and drops one more block when MTP speculative decoding is on, so short prompts reused 44% on an append-only workload. `--prefix-match-unit 16` (vLLM 0.32) raised that to **76%** (ideal 78%) with no change in decode speed. | Engine benchmark, 2026-11-22 (internal report, not public) | One 4B model on one 16 GB card; TP1; thinking off |
| E10 | Cache-aware replica routing (LM Warden) on 8 concurrent agent sessions: median time to first byte **2.33 s to 0.48 s**, prompt tokens from cache **44% to 86%**, output tokens/min **+29%** (8,364 to 10,752). | LM Warden `documents/ROUTING.md`, measured 2026-10-04, published | Synthetic Claude Code-shaped load, 4 x RTX A4000, Qwen3-4B, one run per arm; at 24+ sessions (overload) the median got worse |
| E11 | Stripping reasoning from history to save tokens produced about 3x more generation in agent loops. | LM Warden prompt-diet experiment, 2026-10-28 (internal report, not public) | Internal experiment, one model |
| E12 | A literary question-answering benchmark sent the same request repeatedly to collect several samples, instead of one request with `n` samples, paying prefill once per sample. | Anonymised case study (internal report, not public) | No measured before/after yet; to be measured before it is quoted |

E10 is engine-side, not a prompt change. It belongs in the `lmwarden` skill
and on the [self-hosting page](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.15/docs/self-hosting.md), never presented as what a
leanprompt rule achieves.
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
