# leanprompt: design

Status: **draft for the owner's decision**, 2026-11-22. Design only: no skills
content, no code, nothing published. Name chosen by the owner on 2026-11-22.
Identity: the LM Warden Team (until 0.1.0-dev.7 the identity read differently; see the owner decisions at the end). Planned home: `github.com/Podwarden/leanprompt`
(section 12).

Headline (from 0.1.0-dev.7): **Get more from every LLM call your app makes.** The first
tagline, "Stop paying for the same prompt twice", covered caching and wasted output only.

leanprompt is the separate, public checklist repo that the Prompt Lens design
proposed under the working name `Podwarden/prompt-cache-checklist` (that
design, section 9.4). It widens the scope from prompt caching to every
avoidable cost of an LLM call: tokens you prefill again (prefill savings) and
tokens you generate again (generation savings).

---

## 1. Audience and promise

**Who it is for.** Developers who build apps that call LLMs (chatbots, agents,
RAG, extraction pipelines, evals, batch jobs), and the AI coding assistants
they work with: Claude Code, Codex, OpenCode, Cursor, and any agent that reads
`AGENTS.md`. The assistant is the primary reader: the skills are written so an
assistant can apply them to the user's codebase without the user knowing the
rules.

**The promise, in one line.** Install leanprompt, ask your assistant to audit
the app, and get a list of the places where the app pays for the same tokens
twice, each with a fix and a way to prove the fix helped.

**What it promises, precisely.**

1. A **scan** of the codebase for LLM calls, with every finding tied to a
   rule, a file and line, and an estimated or measured cost.
2. **Fixes** that keep the meaning of the prompt. A rule that saves tokens but
   changes answers is not a fix (section 3.3, the dates experiment).
3. **Proof**: every rule says how to verify it, with the provider's own
   `cached_tokens` (or `cache_read_input_tokens`) and with kvsig ids, before
   and after.

**What it does not promise.** It does not promise a percentage saving for an
unseen app, it does not rewrite prompts on the wire, it does not judge model
choice beyond routing obviously trivial calls, and it does not sell a hosted
service. Numbers in the README are measured on named workloads and say so.

**Why it can spread.** Every project that calls an LLM has at least one of
these mistakes, the fix is usually small, and the saving shows up on the next
invoice. The audit gives a score people can put in a README badge, and the
score is computed from the provider's own usage fields, so it is hard to argue
with.

---

## 2. Evidence this repo is built on

Only measured facts go into rules, the README and the launch posts. Each one
carries its source and its limits. Anonymised: no customer names, no internal
hosts, no keys.

| # | Finding | Source | Limits |
|---|---|---|---|
| E1 | Anthropic cached **0 tokens on 29 turns** of Codex and OpenCode sessions, which send no `cache_control`; kvsig predicted 247,947 reusable. The Claude Code sessions, which set 3 breakpoints, matched kvsig at 100% and 97% (435,661 of 471,607 prompt tokens cached on one). | OpenRouter test 1, 2026-11-21 (kvsig-tools report) | One replay per session, gaps capped at 8 s, `max_tokens` 1 |
| E2 | On automatic caches (OpenAI, DeepSeek-class on DeepInfra) kvsig prefix ids predicted provider `cached_tokens` with **95% and 96% token agreement**. OpenAI reports cached tokens as 1,024 plus multiples of 128; DeepInfra in multiples of 64. | same | Three models, four sessions |
| E3 | A tool appended **at the end** of the list kept most of the cache on automatic caches (DeepInfra cached 10,176 of 21,149 after one deferred tool was appended); on Anthropic, which renders tools first, the same change cached 0 with no breakpoint in front of it. | same | One session |
| E4 | Claude Code's first system line carries a per-session version suffix and the working directory; Anthropic still reused 12,895 tokens across sessions because it renders tools first and the tools were equal. Routes that render the system prompt first lose everything after line 1. | same | |
| E5 | OpenCode writes the working directory into its ~28k-character system prompt. Across sessions in different directories, a self-hosted vLLM reused only the 7,920 tokens before that line. | OpenCode 2.3.2 recapture, 2026-11-22 | One harness, two versions |
| E6 | Moving date lines to the end of the prompt cut correct date answers **from 10/12 to 1/12**, lowered the control question from 7/12 to 4/12, and did not help caching (median cached share 87% control, 80% moved). | Reorder experiment, 2026-11-22 | 16 items, 12 questions per arm |
| E7 | Toggling thinking on and off between turns of one session lost **47% of what those turns could have reused** (329k tokens; 9% of the whole miss). Turns with the same setting as the turn before lost nothing beyond the engine rule. The chat template renders earlier assistant turns differently by flag. | Agent-traffic investigation on a self-hosted vLLM (Qwen hybrid model), 2026-11-22 | One model family's template |
| E8 | The same synthetic agent traffic reused **45.7%** of prompt tokens in its first long run and **89.2%** in a later 30-minute run, after its agents were given realistic stable heads (15k to 25k tokens of system prompt and tool schemas instead of ~1k) and thinking was fixed per session. | Demo generator run summaries, 2026-11-22 | Synthetic; two changes at once; engine settings between the runs to be confirmed (Q2) |
| E9 | On hybrid models vLLM caches in large blocks (1,584 tokens in one production setup) and drops one more block when MTP speculative decoding is on, so short prompts reused 44% on an append-only workload. `--prefix-match-unit 16` (vLLM 0.32) raised that to **76%** (ideal 78%) with no change in decode speed. | Engine benchmark, 2026-11-22 | One 4B model on one 16 GB card; TP1; thinking off |
| E10 | Cache-aware replica routing (LM Warden) on 8 concurrent agent sessions: median time to first byte **2.33 s to 0.48 s**, prompt tokens from cache **44% to 86%**, output tokens/min **+29%** (8,364 to 10,752). | LM Warden `documents/ROUTING.md`, measured 2026-10-04, published | Synthetic Claude Code-shaped load, 4 x RTX A4000, Qwen3-4B, one run per arm; at 24+ sessions (overload) the median got worse |
| E11 | Stripping reasoning from history to save tokens produced about 3x more generation in agent loops. | LM Warden prompt-diet experiment, 2026-10-28 | Internal experiment, one model |
| E12 | A literary question-answering benchmark sent the same request repeatedly to collect several samples, instead of one request with `n` samples, paying prefill once per sample. | Anonymised case study | Needs a measured before/after before it is quoted with numbers (Q3) |

E10 is engine-side, not a prompt change. It belongs in the `lmwarden` skill
and in the README's "self-hosting" section, never presented as what a
leanprompt rule achieves.

---

## 3. The rule format

Every rule is one Markdown file with fixed headings, so the assistant can load
a single rule, the audit can link to it, and the tests can check its shape.

```
---
id: LP-PC-03                 # stable; never reused
title: Fixed tool order and JSON key order
skill: prefill-cache
applies_to: [anthropic, openai, gemini, vllm, sglang, any-automatic]
saves: prefill               # prefill | generation | both
severity: high               # high | medium | low, by typical tokens lost
evidence: [E3]               # rows of section 2, or "provider docs" with a link and date
---
## Rule            one sentence, imperative
## Why             the mechanism, in 3-6 lines, with the provider's render order
## Detect in code  grep patterns and code shapes per language (Python, TS/JS, Go first)
## Fix             a before/after snippet; the smallest change that works
## Don't break meaning   what the fix must not do (for example: do not move a date
                   away from the text that refers to it)
## Verify          two ways: (a) the provider's usage field across two requests;
                   (b) kvsig: which id must stay equal (sys, tools, nodes[i])
## Waste signal    how the audit scores it (section 8), and the Prompt Lens cause
                   code if one exists
```

**Rules of the rule set.**

- A rule without a "Verify" section is not merged.
- A rule that changes prompt order, wording or content must carry "Don't break
  meaning" and an answer check in its evaluation (section 9). This is the
  lesson of E6: the general rule is **stable first, without hurting meaning**,
  not "dynamic last".
- Provider facts (limits, prices, minimums, TTLs) live in one dated table per
  provider (`providers/<name>.md`, "checked on YYYY-MM-DD, source: link"), and
  rules link to them instead of repeating numbers. A CI job flags tables older
  than 90 days.
- Ids are stable (`LP-<skill>-<nn>`), so badges, audit reports and issues can
  refer to them across releases.

---

## 4. The skills

Five skills. Each is a folder with a `SKILL.md` (when to use it, the workflow,
the rule index) and one file per rule. One paragraph each here; the rule lists
are the planned table of contents, not the content.

### 4.1 `llm-call-audit` (flagship)

Scans a codebase for every place it calls an LLM, and reports waste with a
score. The assistant finds call sites by SDK and HTTP shapes (`anthropic`,
`openai`, `@anthropic-ai/sdk`, `google-genai`, LangChain, LlamaIndex, LiteLLM,
Vercel AI SDK, raw `fetch`/`requests` to `/v1/chat/completions`,
`/v1/messages`, `/v1/responses`), follows each one back to where its system
prompt, tools and history are built, and checks it against the rules of the
other four skills. Output is a Markdown report (`leanprompt-report.md`) with:
the call inventory (file, provider, model, call kind: chat, agent loop,
one-shot, batch), findings ranked by estimated tokens lost per 1,000 calls,
each with a rule id, file and line, the fix, and the verify step; and the
score (section 8), labelled **static** (from code) or **measured** (from usage
logs or a kvsig replay). The audit never edits code on its own; it proposes
one fix per finding and asks, and it hands over to `measure-loop` to prove
each fix.

### 4.2 `prefill-cache`

Makes prompts that the provider's cache can reuse. It opens with the provider
facts the assistant must know, kept in the dated tables:

- **Anthropic**: caching happens only at `cache_control` breakpoints (at most 4
  per request) or with top-level automatic caching, which places and moves one
  breakpoint for you; render order is tools, then system, then messages; the
  minimum cacheable prefix is per model (512 to 4,096 tokens) and shorter
  prefixes silently do not cache; 5-minute default TTL or 1 hour; reads are
  billed at a fraction of input and writes at a premium; a read looks back a
  limited number of blocks (20) from a breakpoint. E1 is the headline: no
  breakpoints, no cache.
- **OpenAI**: automatic from 1,024 tokens, reported in 128-token steps (E2);
  `prompt_cache_key` helps requests that share a prefix land together; at most
  128 tools per request; render order system, then tools (E3).
- **Gemini**: implicit caching on current models, plus explicit context
  caching (a cached-content object with a TTL and storage billing) for large
  shared context. Facts to be checked against Google's docs when the table is
  written; nothing here is measured yet.
- **vLLM and SGLang (self-hosted)**: automatic prefix caching (vLLM
  `--enable-prefix-caching`, SGLang's radix cache); reuse is in whole blocks,
  so the tail of every prompt is recomputed; hybrid models can have very large
  blocks and speculative decoding drops one more (E9); `--prefix-match-unit`
  on recent vLLM; with several replicas, reuse needs the request to reach the
  replica that holds the prefix (E10).

The rules, in order of typical impact: put cache marks where the provider
needs them (LP-PC-01); stable content first, **without hurting meaning**: make
a dynamic value stable (a date instead of a timestamp) or put it in the newest
user message, and re-check answers after any reordering (LP-PC-02, E6); no
ids, timestamps, versions or filesystem paths at the top of the prompt
(LP-PC-03, E4, E5); fixed tool order and JSON key order, serialised the same
way every time (LP-PC-04); tool lists that grow only at the end (LP-PC-05,
E3); append-only history: never rewrite a message already sent, including
reminders, whitespace and re-serialised tool results (LP-PC-06); shared
context before per-user context (LP-PC-07); cache-aware compaction: keep the
system prompt and tools byte-identical and append the summary (LP-PC-08);
consistent reasoning handling: keep or drop reasoning the same way every turn,
and fix the thinking setting per session (LP-PC-09, E7, E11); stable image and
attachment placement (LP-PC-10); keep pauses inside the cache lifetime, or
expect a cold prefix (LP-PC-11); do not split one logical prefix across
models or keys that do not share a cache (LP-PC-12).

### 4.3 `generation-economy`

Stops paying to generate, or to prefill again, what one call could have
produced. Rules: ask for `n` samples in one request where the API supports it,
instead of repeating the request (LP-GE-01, E12); batch independent questions
about the same context into one call with a structured output, one field per
question, where answers do not depend on each other (LP-GE-02, with an answer
check); set `max_tokens` and thinking or effort budgets that fit the task, so
outputs are neither truncated (and retried) nor padded (LP-GE-03); stream long
outputs and set timeouts that match the expected generation time, instead of
short timeouts that retry a request the server is still generating (LP-GE-04);
retry only on retryable errors, with backoff, and never retry a truncation
with the same `max_tokens` (LP-GE-05); cache exact responses for identical,
deterministic requests (classification, extraction of the same document) in
the app (LP-GE-06); use the provider's batch API for work that can wait
(LP-GE-07); route trivially small calls (titles, labels, yes/no
classification) to a small model, measured with an answer check (LP-GE-08);
use predicted outputs where the provider supports them, for edits that return
mostly unchanged text (LP-GE-09); ask for structured output instead of parsing
prose and re-asking on a parse failure (LP-GE-10). Each rule names which
providers support the feature, from the dated tables.

### 4.4 `measure-loop`

The measure, change, measure loop, so no fix is claimed without numbers. It
covers: reading the cache fields of every provider (`usage.prompt_tokens_details.cached_tokens`
on OpenAI-compatible APIs and vLLM, `cache_read_input_tokens` and
`cache_creation_input_tokens` on Anthropic, Gemini's cached-content token
count) and logging them per call; a replay harness that sends a recorded
session twice and compares; and **kvsig ids in tests**. kvsig gives every
request keyed ids for its system prompt (`sys`), its tool list (`tools`), the
two together (`head`) and each prefix (`nodes[i]`). Two requests with equal
exact `nodes[i]` have the same prompt up to message `i`, so a CI test can
build the request the app would send for two fixed inputs (two users, two
days, two working directories) and **fail when the stable head changes**. The
same test catches a tool reordered by a refactor, a timestamp added to a
system prompt, or a history store that re-serialises old messages. The skill
explains which id to assert on for each rule (from kvsig's
`docs/reading-the-ids.md`) and how to read a failure ("`sys` differs,
`loose_sys` equal: the system prompt changed only in noise").

Dependency: kvsig 0.1.0 is released (2026-11-22): PyPI `kvsig` and npm
`@kvsig/core` (the unscoped npm name `kvsig` was rejected by npm). From 0.1,
ids under `kvsig/1` and `loose/1`, pinned by test vectors v1, never change
(kvsig SPEC "Versioning and compatibility"); `loose/2` is experimental and
the skill must not assert on it. The skill still reads provider usage fields
first and uses kvsig as the precise, offline check (Q1).

### 4.5 `lmwarden`

When self-hosting is the right answer, and how to do it with a cache-aware
server. Content: when self-hosting pays (steady traffic, long shared prefixes,
data that must not leave the host, NVIDIA GPUs on hand) and when it does not
(no GPU, spiky low traffic, needs a frontier model); LM Warden as the
recommended self-hosted option: an OpenAI-compatible API on your own NVIDIA
GPUs, vLLM and llama.cpp behind one port, a key per consumer with usage
attributed to it, and replica routing that keeps a conversation on the replica
that holds its cache (E10, with its limits stated, including the overload
result); engine settings that change reuse (prefix caching, block granularity,
`--prefix-match-unit`, E9); **Prompt Lens**, the planned LM Warden view that
names the first part of a prompt that broke reuse and what the miss cost,
with an API and MCP tools for assistants, described as planned until it ships;
keys and isolation (one key per app or tenant, why a shared cache across
tenants is a privacy question, `cache_salt` and kvsig scopes). Honest
positioning: LM Warden is one option among vLLM, SGLang, llama.cpp, Ollama and
hosted APIs; the skill says what it adds (lifecycle, per-key accounting,
cache-aware routing) and what it does not (it does not make models faster, it
is single host, NVIDIA only).

---

## 5. Packaging for each assistant

One source of truth: `skills/<name>/SKILL.md` plus `skills/<name>/rules/*.md`.
A build script generates the per-assistant forms, and CI checks the generated
files are up to date.

| Assistant | Form | Location after install |
|---|---|---|
| Claude Code | Skills folder, plus a plugin in a plugin marketplace (`.claude-plugin/marketplace.json` at the repo root) | `~/.claude/skills/` or the project's `.claude/skills/`; or `/plugin marketplace add Podwarden/leanprompt` then `/plugin install leanprompt` |
| Codex | `AGENTS.md` block (short: what the skills are and when to load them) plus the skills folder where Codex reads skills | project `AGENTS.md`, skills path per Codex's current docs |
| OpenCode | `AGENTS.md` block plus an `audit` command file | project `AGENTS.md`, `.opencode/command/` |
| Cursor | Project rules (`.cursor/rules/leanprompt-*.mdc`), one per skill, the audit rule set to "agent requested" | `.cursor/rules/` |
| Any agent that reads `AGENTS.md` | The `AGENTS.md` block, pointing at `leanprompt/skills/` vendored in the repo | project root |

The `AGENTS.md` block is kept under 40 lines: rules are loaded on demand, not
pasted into every prompt. A skills repo that bloats every request would break
its own first rule.

Paths for Codex, OpenCode and Cursor are to be checked against each tool's
current documentation when the build script is written; they change often.

## 6. Install in one command

```
npx leanprompt init
```

Detects which assistants the project uses (`.claude/`, `AGENTS.md`,
`.cursor/`, `.opencode/`) and writes the matching forms; `--assistant
claude|codex|opencode|cursor|agents-md` forces one; `--global` installs to the
user's home where the assistant supports it. No network calls besides the
package download, no telemetry. Alternatives on the README: the Claude Code
plugin command, and a `curl ... | sh` that does the same as `npx` for people
without Node. The npm name `leanprompt` is free today (section 12); nothing has
been published.

---

## 7. Repository layout

```
README.md
AGENTS.md                       # the block, also used by this repo itself
skills/<skill>/SKILL.md
skills/<skill>/rules/LP-*.md
providers/{anthropic,openai,gemini,vllm,sglang}.md   # dated fact tables
examples/<app>/{before,after}/  # evaluation apps (section 9)
eval/                           # replay harness and results (JSON, committed)
cli/                            # the npx installer and the score calculator
.claude-plugin/marketplace.json
docs/DESIGN.md                  # this file
LICENSE (Apache-2.0)  LICENSE-DOCS (CC BY 4.0)  NOTICE
CONTRIBUTING.md  GOVERNANCE.md  SECURITY.md  CHANGELOG.md
```

---

## 8. The waste score and the README badge

The score must be honest enough that nobody can game it by editing the
README, and it must say what it was computed from.

**Two kinds, always labelled.**

1. **Measured** (preferred). From usage logs or a replay of real sessions:
   - *Prefill reuse efficiency* = provider-cached prompt tokens / reusable
     prompt tokens. "Reusable" is the longest exact prefix each request shares
     with an earlier request of the same app, computed with kvsig `nodes`
     ids, and capped by the provider's rules (minimum size, block or step
     size, Anthropic breakpoints). This separates what the app can fix from
     what the engine rounds away (E2, E9).
   - *Prefill stability* = reusable prompt tokens / prompt tokens on requests
     that continue an earlier one (same kvsig `conv`). Low stability means the
     app rewrites its own prefix.
   - *Generation waste* = output tokens spent on calls that were repeated
     identically, retried after a truncation, or discarded after a parse
     failure / all output tokens.
2. **Static**. From the code scan only: each finding has a severity weight and
   an estimated share of prompt or output tokens it affects. The static score
   is an estimate and is shown with a "static" label and a lighter badge
   colour. The audit derives each share from its tokens-lost-per-1,000-calls
   estimate and uses the severity default only when no estimate is possible;
   the score reports how many findings used a default (`default_shares: N of
   M`). Findings outside the repository (`<external>`) or waiting on a fact
   (`needs-facts`) count like any other (owner decisions from issue #4, below).

**The number.** `leanprompt score = 100 x (0.6 x prefill efficiency x
stability + 0.4 x (1 - generation waste))`, rounded down, shown with its
inputs. The weights are a starting point to tune on the example apps
(section 9) and are published with the formula; a change of formula is a
minor version and is listed in the CHANGELOG.

**The badge.** `leanprompt | 87 measured` or `leanprompt | 72 static`, generated
by `npx leanprompt score` into a small JSON file committed to the repo
(`.leanprompt/score.json`: score, kind, inputs, date, leanprompt version,
number of calls measured). The badge is rendered by shields.io's endpoint
badge from that file. No hosted service, no upload: the file is the evidence,
and anyone can rerun the command. A measured score needs at least 50 calls and
says how many it used.

**Not in the score.** Model choice, answer quality, money (prices change; the
report shows money separately, with the price card and its date).

---

## 9. Evaluation: how we prove each rule helps

- **Example apps** under `examples/`, each in a `before/` and an `after/`
  form, small enough to read in one sitting: a chat app with a dated system
  prompt; an agent loop with a tool registry built from a dict; a RAG app that
  puts retrieved chunks before the instructions; a batch extractor that
  repeats requests for samples; an app that retries on short timeouts; a
  harness that compacts by rewriting the system prompt.
- **Replay**: each app runs a fixed scenario against each provider in the
  dated tables and against a self-hosted vLLM, and records usage per call. The
  results (JSON, no prompt text) are committed under `eval/results/` with the
  date, model and provider. Spend per run is capped and reported, as in the
  OpenRouter test (the E1 test cost $0.36 for 152 replayed turns).
- **What counts as "helps"**: the after form reduces prompt tokens billed at
  full price, or output tokens, by more than run-to-run noise (two runs per
  arm minimum), **and** the app's answer check still passes. Every app has an
  answer check (exact match, schema match or a fixed judge prompt), because a
  rule that saves tokens and breaks answers fails (E6).
- **Per rule**: the rule file links to the example and the result that
  supports it. A rule with only a provider-doc source is marked "documented,
  not yet measured here".
- **The audit itself** is evaluated by seeding the example apps' `before/`
  forms with known findings and checking that the audit finds them (recall)
  and does not flag the `after/` forms (false positives), with each supported
  assistant.

---

## 10. Governance and tone

- **Neutral about providers.** Each provider gets the same treatment: its
  rules, its render order, its limits, from its own docs, dated. No provider
  is called better. Where one provider caches nothing without marks (E1), the
  rule says so as a fact and gives the fix.
- **LM Warden is the recommended self-hosted option**, in the `lmwarden`
  skill and one README section, with its limits stated. Other skills never
  require it. kvsig is recommended as the measurement standard because it is
  an open, keyed, vendor-neutral spec; the skills also work with provider
  usage fields alone.
- **No hype.** No "up to 90%" without a workload; every number has a source
  row in section 2 or `eval/results/`. No "AI-powered", no exclamation marks.
  Claims say what was measured, on what, and its limits.
- **Contributions**: issues and pull requests welcome; a new rule needs a
  "Verify" section and either a measured example or a dated provider-doc
  source. DCO sign-off, as kvsig. Maintainers: the LM Warden Team.
- **Corrections**: a wrong provider fact is fixed within a week of a report,
  with a CHANGELOG line.

## 11. License and identity

Code (the CLI, the score calculator, the eval harness, example apps) under
Apache-2.0; documentation and the skills text (`skills/`, `providers/`,
`docs/`, README) under CC BY 4.0, as in kvsig. Copyright and authorship: the
LM Warden Team. "PodWarden" and "LM Warden" are trademarks of their owners;
the NOTICE says so, as kvsig's does.

---

## 12. Name collision check (2026-11-22)

| Registry | `leanprompt` | Notes |
|---|---|---|
| npm | **free** (404); `lean-prompt` also free | |
| PyPI | **taken**: a FastAPI LLM framework, v0.4.4, last release May 2026, MIT | `lean-prompt` free |
| GitHub repos | 7 matches for "leanprompt": `Adi-gyt/leanprompt` (VS Code extension, "write better AI prompts and stop burning tokens", 1 star), `itaides/leanprompt` (prompt compression SDKs, 0 stars), `WinM2M/leanprompt` and `leanprompt-client` (the PyPI framework), `IvicaV/LeanPrompts` (prompt IDE, 3 stars), two `Shivam-Sheth` repos | None above 3 stars. Two are in the same "spend fewer tokens" space |
| GitHub org/user `leanprompt` | free | |
| `Podwarden/leanprompt` | free | `Podwarden` is a GitHub **user** account, not an organisation |
| Domains | `leanprompt.com` (since 2023) and `leanprompt.ai` (since 2025) registered by others; `leanprompt.dev` returned no registration record | Trademark databases not checked |

**Verdict: usable.** GitHub repo names are namespaced, so `Podwarden/leanprompt`
is free and clean, and the npm name, which the one-command install needs, is
free. The PyPI name is taken; leanprompt does not need a Python package (the
installer is npm, and kvsig is the Python package), and if one is ever needed
it can be `leanprompt-cli`. The real risk is search confusion with two small
same-name repos in the token-saving space; at 0 to 3 stars each, a launched
repo will outrank them quickly, but the README should say "by the LM Warden
Team" near its top. Recommended path: **`github.com/Podwarden/leanprompt`**,
npm package `leanprompt`, docs on the README (no domain needed for launch).

---

## 13. Launch plan

**The hook.** "Your app sends the same 20,000-token prompt on every call. Is
it paying for it every time?" with E1 as the proof: replayed coding-agent
sessions on one provider got 0 tokens from cache when the client sent no cache
marks, and 92% when it sent them.

**Demo GIF** (20 to 30 s, terminal only): `npx leanprompt init` in a small
open-source agent app, then the assistant runs the audit: the call inventory
scrolls, three findings appear (a timestamp at the top of the system prompt,
tools built from an unsorted dict, a retry loop on a 10 s timeout), the score
reads 41 static. The fix is applied, the replay runs twice, the provider's
`cached_tokens` column fills in, the score reads 88 measured. Recorded on a
real run; the numbers in the GIF are the numbers in `eval/results/`.

**Where, in order.**

1. **Show HN**: "Show HN: leanprompt, get more from every LLM call your app
   makes". First comment: the evidence
   table (E1, E6, E7), with the dates experiment as the counterintuitive
   finding ("moving the date to the end made answers worse and did not help
   the cache").
2. **r/LocalLLaMA**: lead with the self-hosted side: block granularity, the
   `--prefix-match-unit` result (E9), thinking toggles (E7), and cache-aware
   routing (E10), with LM Warden as the tool and the limits stated.
3. **X**: a thread of five findings, one chart each, from section 2; link to
   the repo at the end.
4. **dev.to**: a long post, "The prompt-cache checklist: 12 rules, each with a
   way to prove it", built from the `prefill-cache` skill.

**Timing.** kvsig 0.1 is on PyPI and npm (done 2026-11-22, so the measure
step installs cleanly); still waiting on the example apps' results and the
Prompt Lens dock (Q6); launch on a weekday morning US
time; one maintainer answers comments for the first 48 hours.

**Not done for launch**: paid promotion, a hosted dashboard, a domain.

---

## 14. Open questions

Kept short; the recommendations are in the reply to the owner and repeated
here.

| # | Question | Recommendation |
|---|---|---|
| Q1 | Launch before kvsig 0.1 is on PyPI and npm? | No: release kvsig 0.1 first, or ship `measure-loop` on provider usage fields only and add kvsig when it is out. **Resolved: kvsig 0.1.0 released 2026-11-22 (PyPI `kvsig`, npm `@kvsig/core`).** |
| Q2 | Can E8 (45.7% to 89.2%) be quoted? | Only after confirming the engine settings of both runs, and as "realistic stable heads and per-session thinking", not as one rule's effect |
| Q3 | Quote E12 (n samples) with numbers? | Measure it on an example app first; until then describe it without numbers |
| Q4 | Score weights (0.6 / 0.4) | Keep as a start, tune on the example apps, publish the formula |
| Q5 | Plugin marketplace: this repo, or a shared `Podwarden` marketplace? | This repo's own `marketplace.json`; one less moving part |
| Q6 | Prompt Lens in the launch copy | Mention as planned only; the launch stands on provider usage fields and kvsig |

## Owner decisions (2026-11-22)
- Name: keep "leanprompt"; claim the npm name now with a placeholder (0.0.1, README only).
- Q1: release kvsig 0.1 (installable) before launching leanprompt. Done: kvsig 0.1.0 on PyPI (`kvsig`) and npm (`@kvsig/core`), 2026-11-22.
- Q2: the demo number is quoted only with its context (see below); wording to be approved.
- Q3: case studies use synthetic data and tests (example apps in this repo), no real-user numbers.
- Q4: score formula 0.6 prefill / 0.4 generation, measured badge after >= 50 calls, published and tuned on the example apps.
- Q5: install from this repo's own plugin marketplace.
- Q6: launch copy presents Prompt Lens as available: launch only after the Prompt Lens dock is live on LM Warden.

## Addition (owner-approved 2026-11-22): targets and priorities

### Target profile
A project file `leanprompt.yaml` (optional; the audit asks or infers when absent):
- `target`: provider (anthropic | openai | gemini | openrouter | ...) or self-hosted engine (vllm | sglang | llama.cpp | lm-warden), model family, context length.
- `engine` (self-hosted): cache block size, prefix match unit, speculative decoding (MTP/eagle) on/off, KV memory / max context.
- `priority`: cost | speed | quality, or weights (e.g. `{cost: 0.5, speed: 0.3, quality: 0.2}`).
Every skill reads it; the audit's findings and the rule advice are filtered and ranked for that target and priority.

### Priority-aware advice
- Speed first: streaming, tighter output budgets, thinking off/low effort, smaller models for simple steps, predicted outputs where available.
- Cost first: aggressive caching, batch APIs, `n` samples instead of repeats, exact-response caching, cheaper models.
- Quality first: keep thinking with budgets that never truncate answers, larger models for hard steps; caching always applies (it never changes answers).

### Per-model habits
A dated table per model family: thinking/reasoning controls (Qwen enable_thinking / templates, OpenAI reasoning_effort, Anthropic thinking budgets), cache marker limits, tool-calling and JSON-output quirks.

### Hardware (self-hosted)
Engine flags that change reuse and speed, with evidence (synthetic benchmark: --prefix-match-unit 16 raised short-prompt reuse from 44% to 76% on a hybrid model with 1,584-token blocks), and how prompt length relates to KV memory and context limits.
LM Warden auto-detect: the skill reads the engine facts from LM Warden's API (block size, match unit, speculative decoding) instead of asking. (Needs a small public LM Warden endpoint if not already exposed: check /api/stats/v2/cache engine_block_tokens / engine_match_unit_tokens.)

### Quality guard (fast follow after v1)
Any change that can alter answers (smaller model, less thinking, shorter outputs, prompt reordering) ships with a before/after eval recipe: a fixed synthetic input set, compared outputs, pass/fail. Caching-only changes are exempt. Lesson recorded: a cache-friendly reorder (dates moved to the end) hurt answers until checked.

Scope: v1 = target profile, priorities, per-model habits, LM Warden auto-detect. v1.1 = the quality guard.

## Addition (owner-approved 2026-11-22): OpenRouter and frontier models

### OpenRouter (a router, not a cache)
- Cache hits depend on the upstream provider: keep one provider per conversation (pin provider order, limit fallbacks for long sessions; verify OpenRouter's sticky routing per model in the dated table).
- Pass cache markers through for Anthropic and Gemini models and verify they are forwarded.
- Measure with OpenRouter's usage accounting (cached tokens and cost per request): the audit's measured score.
- Evidence (our test): coding-agent sessions on an Anthropic model via OpenRouter, 0% cached without cache marks vs 92% with them.

### Frontier providers
- Anthropic: explicit cache markers (max 4), 5-minute or 1-hour lifetime, write premium, cheap reads: place markers on stable parts; pick lifetime by reuse interval.
- OpenAI: automatic caching above 1,024 tokens; a stable prompt_cache_key per conversation/tenant improves routing to the same cache.
- Gemini: implicit caching on newer models; explicit cache objects billed per hour of storage: only for content reused many times within the lifetime.
- Others (DeepSeek, xAI, Mistral, ...): mostly automatic; listed as "check" until verified.

### Break-even rule
When cache writes cost a premium, an unreused prompt costs more than no caching. The audit estimates, from measured usage, how often each prompt returns within the cache lifetime and advises: mark / don't mark / longer lifetime / restructure.

### Frontier generation economy
Batch APIs (about half price, non-interactive work), cheaper service tiers where offered, reasoning-effort and thinking-budget controls, predicted outputs for edits that repeat most of a file; chosen per the target profile's priority.

### Honesty rule
Every price, threshold and lifetime lives in a dated fact table with a source link and a "last checked" date; CI warns when an entry is older than 90 days.

- Name (2026-11-22, owner): keep "leanprompt" despite itaides/leanprompt (MIT, prompt compression, TS/Rust/Go, active; its README advertises npm install leanprompt). We hold the npm name. Launch copy must clearly separate caching from compression.

## Owner decisions (2026-11-25, on the v1 implementation plan)
- D1: missing Anthropic cache marks count against the app; "reusable" is capped by minimum, step and block size and by the provider's cache lifetime, not by the presence of marks.
- D2: reusable tokens are estimated by character share; the score output says so.
- D3: one `score.json`, which is also the shields endpoint badge source (shields allows and strips unknown keys; checked 2026-11-25). Section 8 stands as written.
- D4: default static shares high 0.5 / medium 0.2 / low 0.05, plus `leanprompt calibrate`: a trial run on the user's real or synthetic data that scales the shares for that app. The 0.6 / 0.4 split stays global.
- D5: Python ships as PyPI `leanprompt-cli` (import `leanprompt_cli`); this supersedes "leanprompt does not need a Python package" in section 12.
- D6: simulator results are CI-only and never quoted.

## Owner decisions (2026-11-26, during the v1 build)
- No UI of its own: the user's coding assistant is the interface (`presenting.md` in the audit skill); `leanprompt report --html` writes one local, self-contained page.
- Lessons learned come through a GitHub "Lesson learned" issue form that the user opens after reviewing the exact text (`leanprompt lesson` drafts it locally and sends nothing). A maintainer reviews every submission before it informs a rule; submitted text is never pasted into a skill. THANKYOU.md credits are optional (a name and, if wanted, a project with a link, without endorsement). An lmwarden.com endpoint is deferred.
- Cross-platform: CI on Linux, macOS and Windows; Windows installs with `npx leanprompt init`.
- v2: a Rust CLI (six signed binaries, golden tests generated from v1, `npx leanprompt` as a thin wrapper) so no Node or Python is needed on the host. The usage loggers stay in TypeScript and Python. v1 ships in TypeScript.
- LM Warden auto-detect targets a key-scoped `GET /api/me/engine` endpoint requested from the LM Warden team (handoff 2026-11-26); until a release has it, the engine block is set by hand.

## Owner decisions (2026-11-26, from issue #4)
- Two backends: `leanprompt.yaml` gains `targets:`, a list whose entries each name exactly one `provider` or `engine` (validated as `target`), with optional `model_family`, `context_tokens` and `files:` (globs). `target` stays valid; `target` and `targets` together are an error. Engine facts: the top-level `engine:` keeps working for a single engine entry; with two engine entries each carries its own (`engine_facts`). Scoring takes each usage record's facts from its own provider or engine name; a name with no table falls back to the matching `targets` entry, then to a single target; with several targets and no match the record is unmeasured as `ambiguous_target`, never guessed. `profile detect` writes into the lm-warden (else vllm) entry. The audit records each backend as a `targets` entry (offered, written on a yes), evaluates the rules per backend, and checks `applies_to` against each finding's backend.
- Findings outside the repository are recorded and scored: `findings.json` accepts `"file": "<external>"` (with `where`; `line` optional or 0) and `"status": "needs-facts"` (with `confirm`, the fact that would confirm or dismiss it). They count in the static score like any other; the report, `presenting.md` and `report --html` list them, ranked, as open questions with the `confirm` text. `eval-audit` leaves `<external>` findings out of recall and false positives.
- The audit estimates share: every finding gets a `share` = estimated tokens lost on the affected side ÷ that side's tokens for the same calls, with the assumptions in the report; the severity default is the fallback only when no estimate is possible, and the report says so. `score --static` and `score.json` `diagnostics` report `default_shares: N of M`; `report --html` shows it next to the static score. `calibrate` is unchanged (it scales only default shares, so with estimated shares it matters less).

## Owner decisions (2026-11-26, 0.1.0-dev.6)
- The HTML page is for people: it explains in plain English what is wrong with the app's LLM calls, what to change and why, from per-finding fields the audit writes (`problem`, `change`, `why`, `estimate`, `assumptions`, `verify`). It hands off to the user's coding agent with a copyable, self-contained block (verify each finding first, fix one at a time with consent, prove with `measure-loop`).
- Money is shown only from the user's own volume and a price with its source and checked date (`volume:`, `prices:` in `leanprompt.yaml`), as a separate block labelled as an estimate (or measured); never invented and never in the score (section 8).
- The star, the share message and the badge are offered only after the page has shown concrete value (an estimate or a measured score), and the badge snippet only when it can work (a public-host remote; `score.json` committed).

## Owner decisions (2026-11-26, 0.1.0-dev.7)
- Headline: **Get more from every LLM call your app makes.** Supporting line: effective, efficient and affordable: your coding assistant makes prompts cacheable, cuts dead weight, stops wasted output and speeds up first tokens, without changing the answers. It replaces "Stop paying for the same prompt twice" at the top of the README and in the package and plugin descriptions.
- Attribution: "by the LM Warden Team" wherever the README, docs, skills, NOTICE, package metadata and the report page name a team. The GitHub address (`github.com/Podwarden/leanprompt`) and the commit identity are unchanged.
- A sixth skill, `prompt-diet` (`LP-PD-*`), for dead weight in what each call sends: tools a route cannot use, instructions said twice, per-turn boilerplate, whole tool results and retrieved context, stale history, padded serialisation. Every trim needs an answer check (measure-loop, before and after on the same scenario, answers unchanged or better); a trim of the shared cacheable head is weighed against the cache loss (`prefill-cache`); E11 is the standing reason not to strip blindly. Compaction stays in LP-PC-08 and is cross-referenced, not restated. Output formats stay in `generation-economy`.

## Owner decisions (2026-11-26, 0.1.0-dev.8)
- Install and discovery follow the Impeccable pattern. `npx leanprompt install` detects the assistants, asks "this project or all your projects" in a terminal, lists every file and asks before writing, and ends with what to type next per assistant (`/leanprompt audit`; `$leanprompt audit` in Codex). Scripts and CI use `--providers=...`, `--scope=project|global` and `--yes`; with no terminal and no `--yes` it prints the plan and exits 1 without writing. `init` stays as an alias that behaves the same. The ownership stamp, symlink containment and "never overwrite a file it did not write" stay.
- Global locations come from each assistant's documentation, recorded in `docs/assistant-paths.md` and in `cli/src/init.ts`: Claude Code `~/.claude/skills`, Codex `~/.agents/skills` and `~/.codex/AGENTS.md`, Cursor `~/.cursor/skills`, OpenCode `~/.config/opencode/{commands,AGENTS.md}`. The `AGENTS.md` convention has no user-level location, so it is project only and the installer says so.
- Cursor documents Agent Skills (`.cursor/skills`, and it also reads `.claude/skills` and `.agents/skills`), so Cursor installs the shared skills form instead of one `.mdc` rule per skill; `forms/cursor/rules` is no longer generated. Old stamped rule files are reported by `update` and left alone.
- `npx leanprompt update` refreshes stamped files in every scope where an install is found, adds files new in the version, reports the changes, and never touches unstamped files.
- One entry skill, `leanprompt`, like `/impeccable`: alone it lists the commands, one line each; `init`, `audit`, `fix`, `measure`, `score`, `report`, `lesson` route to the six existing skills, which remain the reference (no duplicated content). In the Claude Code plugin it is `/leanprompt:leanprompt`; bare `/leanprompt` resolves to it unless another command has that name (Claude Code docs; checked with `--plugin-dir` on 2.1.332). OpenCode gets a `/leanprompt` command file.
- README first screen: dev.7 headline and supporting line, the one-line install with the GitHub fallback while npm is not live (stated plainly), "Reload your assistant, then type `/leanprompt init`", a Without / With pair of `report --html` pages from `examples/dated-chat`, a grouped command table, and a "Works with" line of assistants the forms support. Detail moves to `docs/`.
- `npx leanprompt score --github` prints a GitHub Actions `::warning` per open finding plus a summary notice; exit 0 on findings, 1 on invalid files, 3 with `--fail-under N` when the score is below N. No SARIF for now.
- `docs/registries.md` is a checklist the owner performs (skills.sh, this repo's Claude marketplace, Anthropic's directory, the Cursor marketplace); nothing is submitted from the repository.

## Owner decisions (2026-11-26, 0.1.0-dev.10)
- Credit kvsig in two ways, and never with score points, because the score measures billing outcomes (tokens the provider bills or serves from cache), not which libraries an app uses.
- Recognise it in the audit. When the app imports kvsig or depends on it (`@kvsig/core` on npm, `kvsig` on PyPI), `llm-call-audit` notes per call site which prompt parts carry ids and uses those ids, from the app's own tests or logs, to check stability exactly instead of estimating it from reading the code. `findings.json` records it as an optional top-level `kvsig: {used, where}`, validated by `score`; the report page shows one quiet line in the score section. The score formulas do not read it, and a test proves the score is identical with and without the field. No label or badge change.
- Suggest it in fixes. Where a rule's fix keeps the prompt head stable (LP-PC-01, LP-PC-02, LP-PC-03, LP-PC-04, LP-PC-05, LP-PC-07, LP-PC-08, LP-LW-01, LP-PD-01, LP-PD-02), its "Fix" ends with one optional line: a test in the app that asserts a kvsig id stays equal is one way to keep the fix checkable. The short TypeScript and Python example lives once, in `measure-loop` ("The stable-head test"), next to the existing helper templates; it is offered as its own diff, on a yes, and is never a requirement.
- `profile detect` is unchanged: it reads engine facts from LM Warden only, and dependency detection belongs to the audit's inventory.

## Owner decisions (2026-11-26, 0.1.0-dev.11)
- Anthropic's directory gets a small generated folder, `plugin/`, not the repository root: `.claude-plugin/plugin.json` (with `icon`), `.claude-plugin/icon.png`, a README of at least 40 words that says what the plugin runs, sends and fetches, LICENSE, LICENSE-DOCS, NOTICE, and `skills/` copied from `forms/skills` (no symbolic links). It keeps the reviewer's limits: under 512 files, no file over 256 KiB but images, no `package.json`. `.claude-plugin/marketplace.json` points at `./plugin`, so this repository's marketplace installs the same folder. `build:forms --check` covers `plugin/`, and a test keeps it within those limits.
- The icon is a lean gauge with its needle low, graphite `#161b26`, signal indigo `#2f3db5` and white, with no text; it reads at 32 px. Its source is `docs/assets/icon.svg`, rendered to a 1024 px PNG at `docs/assets/icon.png`, which `build:forms` copies byte for byte to `plugin/.claude-plugin/icon.png`.
- Cursor gets `.cursor-plugin/plugin.json` at the repository root, generated by `build:forms`, with only fields in Cursor's schema (`github.com/cursor/plugins`, `schemas/plugin.schema.json`). Its `skills` field is `./plugin/skills/`, which replaces Cursor's default scan of `skills/`, so Cursor gets the same self-contained skills as Claude (links outside the skills tree are GitHub URLs pinned to the release tag). `logo` is the same icon.
- skills.sh needs no file: `npx skills add Podwarden/leanprompt --list` lists the seven skills (checked on the published repository, skills 1.9.0). It reads `skills/` first and drops later skills with the same name, so the copies in `plugin/skills/` do not appear twice; `skills/_template` has no `SKILL.md` and is not listed.
- The npm package does not carry `plugin/`, `.claude-plugin/` or `.cursor-plugin/`; the registries read them from GitHub.

## Owner decisions (2026-11-26, 0.1.0-dev.13)

From the feedback of four real audits, one of them run independently by an app's own team with its own coding agent.

- **Pre-1.0 score changes (flagged clearly).** Section 8 says a change of the score formula is a minor version. Before 1.0, a development release (`0.1.0-dev.N`) may change the score too, because the formula is still being tuned on real audits; every such change is listed under "Score change" in that release's CHANGELOG entry and in `docs/score.md`, with how to get the old figure where one exists. From 1.0 on, section 8 applies as written.
- **The static score is the app's score.** A finding whose fix is a setting of the server or engine the app calls (`fix_by: "server"`; by default an `LP-LW-*` finding in `<external>`) is left out of the static score, because it made an app look worse than its code: in one audit an engine's cache block size carried most of the score's weight. The formula is unchanged. `score.json` records the figure with those findings (`server.with_server_score`), and `score --with-server` makes it the headline. The page and the Markdown report show them in their own section, "Questions for the server's administrator", each with what would answer it (for LM Warden, `profile detect --lmwarden <url>`). Low-confidence findings that are really questions for the administrator (where a served chat template writes the effort, how many replicas a model runs) are written as questions, not defects. The measured score is unchanged. This supersedes "count like any other" for server findings in the issue #4 decisions; app findings in `<external>` and `needs-facts` findings still count.
- **Notes for verified problems outside the rules.** `findings.json` takes a top-level `notes` array (`title`, `file`, `line`, `problem`, `change`, optional `why` and `verify`), validated and never scored: no `share`, `severity` or `saves`. The page shows them after the findings and the hand-off block includes them. The audit records only problems it has read in the code: a spend meter that ignores cache tokens, a cut-off answer accepted as complete. A metering rule was considered and not added: a meter that undercounts wastes no tokens, so it has no waste signal; it is a note, and LP-PC-01's fix warns about it.
- **Two kinds of unknown.** `needs-facts` stays "behaviour not confirmed" (an open question); `frequency-unknown` is "the code shows it, only the rate is assumed" (a finding, marked on the page). Both need `confirm`.
- **Shares per side.** A `both` finding may give `share_prefill` and `share_output`; `share` alone keeps applying to both sides, so existing files score the same. A fix that adds cache marks may give `tokens_per_1k.cache_write`, priced at the write premium and subtracted from the money, never from the tokens.
- **The audit honours the project's own rules.** It reads `CLAUDE.md`, `AGENTS.md`, decision records and issue references first. A fix the project has ruled out is not proposed; the audit offers an alternative that respects the rule (repairing a malformed JSON reply locally before asking again, where a response format is ruled out). Planned work is linked in `planned`, not presented as new.
- **The Markdown report is generated.** `report --md` writes `leanprompt-report.md` from `findings.json` and `score.json` inside a marked block, so the page and the report cannot drift; the assistant writes the inventory and next steps below it.
- **Offline audits and pinned commands.** The installed skills carry the fact tables (`providers/`, `models/`, `runtimes/`, `docs/evidence.md`, `docs/profile.md`) under `leanprompt/facts/`, linked relatively, and call the CLI pinned to the version that installed them.
- **Unattended audits** ask nothing, use `leanprompt.yaml`, and list the unanswered priority, volume and price questions under "Questions for the owner".
- **Auditing someone else's repository** has its own etiquette in `presenting.md`: install outside it, keep the audit's files out of its history, read its policy before reporting upstream, one verified finding at a time.
- **LP-GE-05** keeps the retry for a model whose reasoning cannot be turned off and raises the limit on it; a retry after a normal stop with an empty answer is not a finding.

### Next (deferred from these audits)

- A per-job or per-workflow unit for batch apps (one book run, one nightly job), next to "per 1,000 calls".
- Throughput advice for batch work on a self-hosted engine (vLLM's batch endpoint), as a note on LP-GE-07.
- A prompt-diet rule for context resent for quality (a whole chapter sent with every scene of a translation), weighing coherence against uncached prefill, with a mandatory answer check.
- App-side advice for one-shot heads shorter than two engine blocks (putting real shared content, such as a style guide, right after the instructions), under LP-LW-01.
- Error-path findings in their own group on the page, so a rare but real bug is not lost at the bottom of a token ranking.
- A way to say "the main LLM cost of this app runs in a client the audit cannot see" (an app driven by an external agent).
- A possible prompt-diet direction, not planned: what is asked of the model. When code can do the obvious part of a task, the model needs to return only the rest (for example, code fills the fields it already knows and the model writes only the judgement). This changes what the model is asked, so it is outside "keep meaning" and would need its own answer checks; recorded here, not implemented.

## Owner decisions (2026-11-27, 0.1.0-dev.14)

From the feedback of seven real audits of public repositories (three of them the first real use of 0.1.0-dev.13) and one run by an app's own team.

- **Prior art is a required step.** Before it writes the findings, the audit searches the project's open and closed issues and pull requests, its docs and its decision records for each candidate finding. `findings.json` gains `known: {kind, url, note}` with kind `planned`, `in-progress`, `reported` or `declined`. `planned` (the 0.1.0-dev.13 text field) stays valid and means `known` with kind `planned`, so older files still parse. Known findings keep their estimates but are not counted among the places, not in the totals and not in the static score; a declined finding is shown only as "Declined by the project" with its link, and is left out of the hand-off block and of any issue the audit drafts. The audit's own report upstream is not prior art: `known` is for what the project had before the audit.
- **Score change (pre-1.0, as the 0.1.0-dev.13 decision allows).** Leaving known findings out raises the static score of a file that has them; `score.json` keeps the old figure (`known.with_known_score`). Findings linked by `overlaps` (by finding `id`) count once per group, the largest share on each side, and the page's totals take the largest token figure of each group, so an app is not charged twice for tokens one fix saves. Listed under "Score change" in the CHANGELOG and in `docs/score.md`.
- **A metering rule after all, as a correctness rule.** This supersedes "a metering rule was considered and not added" in the 0.1.0-dev.13 decisions: the bug appeared in four audits, and the auditors needed the provider facts and the detection shapes in one place. LP-GE-11 (meter every billed token, cached and unfinished ones too) keeps the reasoning of that decision: a meter that undercounts wastes no tokens, so the rule has `saves: none`, a severity and no token share, and the audit records a match as a note that names the rule. A finding cannot use a `saves: none` rule, and the score never reads notes. This follows section 8 ("Not in the score: ... money"): the score measures billing outcomes, and a meter is a report of them.
- **The headline counts what costs tokens.** A finding whose shares and tokens are all 0 stays on the page, marked as costing no tokens today, and is not counted as a place. When the largest open question is larger than the largest finding, the headline names it.
- **Unattended runs say so.** `findings.json` takes `unattended: true`; the page and the Markdown report label the run, and the page shows the same "Questions for the owner" section as the Markdown report.
- **Smaller additions.** `size-unknown` next to `frequency-unknown` (the code shows the problem and how often; only the tokens each time are assumed). A note can name the finding it is another face of (`finding`), a correctness rule with its severity, and `known`. Prices take a `currency` (ISO code), shown as given and never converted; models in different currencies are not added together. `npm_config_registry` is documented for projects whose `.npmrc` points at a private feed. "Auditing someone else's repository" lists the contribution-policy checks (rules on AI-generated contributions, a CLA, issue first, labels reserved for the core team) and asks for one complete post with a disclosure line and no follow-up offers.
- **Provider tables** for Vercel AI Gateway, Alibaba Model Studio and Azure OpenAI, and the OpenAI Node SDK's defaults and the GPT-5.4 family's reasoning defaults in `providers/openai.md`, each fact from an official page with the date read.

### Next (deferred from these audits)

- A top-level `traffic:` (or `call_mix:`) assumption that findings can refer to, for apps that choose among many providers or models at run time, shown on the page as assumed.
- `callers` or `also_at` on a finding, for one helper with many call sites, and one card for one decision found in two files.
- Volume and prices the audit found itself (public run logs, the provider's page) recorded in `findings.json` as found by the audit and not confirmed by the owner, and a top-level `target` for unattended runs.
- `status: "information"` for a finding that is recorded but not recommended (a batch API that does not fit the schedule), dropped from the hand-off list.
- A rule or a note pattern for a fixed-length head slice of a structured document passed to a summariser, which cuts the context the call needs.
- Using an app's committed or logged model outputs as evidence of how often a finding happens.
- A `decision: {doc, quote}` on a finding for a documented project decision that is not a tracker item.
- Ranking latency-only findings (a retry of a non-retryable error that costs minutes, not tokens) under a speed priority, or a time column.
- The G input's label against the sum of output shares (G combines shares as a product, so it is below their sum), stated on the page.
- "(estimate)" appended to an `estimate` text that already says it is not estimated.
- A `known` kind, or another record, for work the project finished before the audit.
- The items deferred from 0.1.0-dev.13 above remain.
