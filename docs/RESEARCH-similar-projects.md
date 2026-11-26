# Research: projects similar to leanprompt

Date: 2026-11-22. Star counts and last-push dates come from the GitHub API on that day. Web findings come from standard-mode search and are marked where they rest on blogs rather than primary docs.

leanprompt, as planned: an open-source skills repo that teaches coding assistants to make the LLM-calling apps they build cheaper and faster. It covers cache-friendly prompt layout (to save prefill), generation savings (n samples, batching, budgets, no wasted retries), and a codebase audit that produces a waste score. Results are measured with the kvsig open standard, and the repo points readers to LM Warden.

## The finding that shapes everything else

Nearly every popular "save tokens" project targets **the coding agent's own bill**. caveman (122k stars), cache-tax, claude-code-cache-fix, the statusline meters and skillmeter all make Claude Code or Codex sessions cheaper. Almost nobody targets **the app the agent is building**: the `client.messages.create()` calls that run in production a million times a month. That is leanprompt's lane. The README has to say so in its first line, or readers will file it with caveman.

## 1. Skills and rules collections for coding assistants

| Project | Stars / last push | What it is | Lesson | Overlap |
|---|---|---|---|---|
| [obra/superpowers](https://github.com/obra/superpowers) | 324k / 2026-11-03 | Skills framework that enforces a whole dev methodology (TDD, plans, review) and triggers automatically | Opinionated skills that fire on their own and change behaviour beat passive reference docs | None (methodology, not cost) |
| [anthropics/skills](https://github.com/anthropics/skills) | 199k / 2026-11-16 | Official Agent Skills repo. Its `claude-api` skill ships `shared/prompt-caching.md`, a caching audit workflow (trace prompt assembly, classify inputs by stability, place breakpoints, anti-pattern table) | The format reference to follow. It also already covers Anthropic-only caching advice, so leanprompt must not merely restate it | **Partial**: Anthropic caching only. No other providers, no self-hosted, no generation side, no score |
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | 122k / 2026-11-22 | "why use many token when few token do trick". A skill plus proxy that makes agents terser. Leads with benchmark numbers (Terminal-Bench, $ per solved task) | Went viral on a memorable voice, a one-line joke tagline and **headline measured numbers** in the hero | Adjacent: cuts the agent's tokens, not the app's |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 80k / 2026-09-18 | Curated list | The main listing target for distribution | Distribution channel |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | 59k / 2026-11-22 | Hand-picked list with a "Usage & Cost" section. Entries are praised for engineering evidence (tests, benchmarks, honest local-only design) | The curators reward rigour signals, so ship tests and evals for the skills | Distribution channel |
| [PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) | 41k / 2026-05-30 | .cursorrules collection, CC0 | Rules files are stale now (last push May). Skills and AGENTS.md have overtaken them, but a `.cursor/rules` export is cheap reach | Distribution (export format) |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | 35k / 2026-11-20 | Vendor-official skills | A vendor that publishes skills about its own platform gains trust. That is the model for LM Warden-adjacent skills | Pattern to copy |
| [openai/skills](https://github.com/openai/skills) | 29k / 2026-10-28 | Codex skills catalog (`.curated`, `.system`) | Codex installs via `$skill-installer` from a GitHub path, so lay out `skills/<name>/` accordingly | Distribution (Codex) |
| [agentsmd/agents.md](https://github.com/agentsmd/agents.md) | 26k / 2026-09-10 | Open AGENTS.md format | Offer an AGENTS.md snippet for agents without skills support | Distribution (format) |
| [heydamir/unslop](https://github.com/heydamir/unslop) | 20k in about 3 weeks (created 2026-10-29) | Skill that finds "AI-looking" UI and fixes it pass by pass. Plugin marketplace install, Codex and Antigravity too | **Names an enemy everyone recognises ("slop")**, shows a before/after animation, installs in one command, and came with an X series by its author | None; the playbook to copy |
| [nidhinjs/prompt-master](https://github.com/nidhinjs/prompt-master) | 16k / 2026-10-22 | Skill that writes sharper prompts; "zero tokens wasted" | "Wasted credits" framing sells, but this is about users' own prompts | Low (name-space: "waste") |
| [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills), [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) | 30k, 12k | Large skill bundles (67 to 410 skills) | Breadth bundles get stars but little depth; a focused pack can still win | None |
| [kunchenguid/axi](https://github.com/kunchenguid/axi) | 2.3k / 2026-11-21 | Design principles for agent ergonomics, "lower token cost" | Principles plus measurement works as a format | Low |
| [panhwerwaseem/llm-cost-audit](https://github.com/panhwerwaseem/llm-cost-audit) | 0 / 2026-11-05 | Agent skill that audits an **app's** token spend and cache-read share from usage logs; refuses to recommend before measuring | **Closest concept found.** Its "no claim without a log" protocol is good; it is log-based only, has no static audit and no score | **High** (tiny, unknown) |
| [nirajpant07/skillmeter](https://github.com/nirajpant07/skillmeter), [codegobrrrr9/skilldiet](https://github.com/codegobrrrr9/skilldiet) | 0 | Measure what skills cost in context | Expect scrutiny of leanprompt's own context footprint, so keep SKILL.md lean | Low |

Why the big ones won (summary): one-line installs (`claude plugin install ... --marketplace`, a Codex `$skill-installer` URL, a zip for claude.ai); a memorable enemy or voice ("slop", "caveman"); a hero GIF or before/after; measured numbers above the fold (caveman); an author pushing a social series (unslop on X); and support for many agents (Claude Code, Codex, Cursor, Gemini CLI, Antigravity). Blogs note that GitHub trending rewards early momentum and that skills repos are cheap to make, so the field is crowded and noisy ([Snyk](https://snyk.io/fr/articles/top-claude-skills-developers/), [jamesbachini.com](https://jamesbachini.com/claude-skills/)). Snyk also advises reviewing a skill's bundled scripts before installing, so keep scripts few and readable.

## 2. Prompt caching guides, cost tools and compression

| Project | Stars / last push | What it is | Lesson | Overlap |
|---|---|---|---|---|
| [Anthropic cache diagnostics (beta)](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics) | Docs | Beta header `cache-diagnosis-2026-04-07`. You pass `previous_message_id` and the API reports where the prefix first diverged (system, tools, messages). Claude API only, not Bedrock or Vertex | A provider-side "why did I miss" exists for one vendor. leanprompt should use it and generalise the idea across providers and self-hosted servers | Complementary |
| [BerriAI/litellm](https://github.com/BerriAI/litellm) | 64k / 2026-11-22 | Gateway with cost tracking and a [prompt caching tutorial](https://docs.litellm.ai/docs/tutorials/prompt_caching.md) | Cost tracking is a commodity; telling people *what to change in code* is not | Low (runtime, not advice) |
| [langfuse/langfuse](https://github.com/langfuse/langfuse), [Helicone/helicone](https://github.com/Helicone/helicone) | 38k, 6.3k | Observability that shows cached-token analytics | They show the symptom after deploy. leanprompt fixes the cause before deploy | Low; integrate as data sources |
| [AgentOps-AI/tokencost](https://github.com/AgentOps-AI/tokencost) | 2.0k / **2025-09-05 (stale)** | Price table for 400+ LLMs | Price tables rot fast. Do not hard-code prices; take a user-supplied table | Low |
| [Rodiun/frugon](https://github.com/Rodiun/frugon) | 218 / 2026-10-19 | Local LLM cost analyzer over JSONL logs; capture proxy; routing advice | "Your LLM bill is leaking", local-only, `uvx` one-shot, `--demo` mode | Medium (log analysis) |
| [QuesmaOrg/awesome-ai-tokenomics](https://github.com/QuesmaOrg/awesome-ai-tokenomics) | 221 / 2026-11-13 | Curated list: Caching, Compression, Retry, Budgets, Serving Inference... | A taxonomy to borrow for skill names, and a listing target | Distribution |
| [karanb192/cache-tax](https://github.com/karanb192/cache-tax) | 453 / 2026-11-17 | Keeps Claude Code's cache warm; shows a $ estimate before a cold send | A **real recorded dollar figure ($6.61)** in the GIF sells cache economics | Adjacent (agent's bill) |
| [cnighswonger/claude-code-cache-fix](https://github.com/cnighswonger/claude-code-cache-fix) | 449 | Fixes a cache regression ("up to 20x cost") | Cache misses are an emotional topic; "20x" headlines spread | Adjacent |
| CacheLens (hinanohart/cachelens; GitHub repo now 404, seen via [ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fhinanohart%2Fcachelens)) | n/a | `lint` a request for cache breakers (timestamps, UUIDs, tool order); `check` CI gate with a threshold | A CI-gate threshold is a good shape for the waste score | High concept, gone |
| [AlexRyan92/prompt-cache-linter](https://github.com/AlexRyan92/prompt-cache-linter) | 0 / 2026-10-11 | Finds the exact byte where the cache breaks and the monthly cost of the miss | "Exact byte + $/month" is the right output shape | High concept, no traction |
| npm `prompt-cache-optimizer` 0.6.0 (2026-06) | npm | SDK wrappers that measure hit rate, reorder tools and messages, and manage the Gemini CachedContent TTL | Runtime wrappers exist; leanprompt teaches the code change instead of adding a dependency | Medium |
| [Pydantic AI warn-on-cache-busts](https://pydantic.dev/docs/ai/harness/warn-on-cache-busts/index.md) | Docs | Runtime warning when the hit rate collapses between requests | Frameworks are adding cache-bust detection; cite and recommend it | Complementary |
| [microsoft/LLMLingua](https://github.com/microsoft/LLMLingua) | 6.9k / 2026-11-09 | Neural prompt compression | See below | Conflicting technique |
| [jia-gao/leanctx](https://github.com/jia-gao/leanctx) | 324 / 2026-08-22 | Drop-in compression wrapper (`from leanctx import OpenAI`), LongBench v2 numbers from committed data | Reproducible per-item benchmark data builds trust. **The name is close to "leanprompt"** | Name-adjacent; opposite technique |
| [LMCache](https://github.com/LMCache/LMCache), [vLLM](https://github.com/vllm-project/vllm), [SGLang](https://github.com/sgl-project/sglang) | 12k, 97k, 39k | Server-side KV and prefix caching (vLLM APC, SGLang RadixAttention) | The self-hosted cache story is engine-level; nobody teaches *app authors* to write prompts that hit it | LM Warden's arena |

Blog evidence (secondary sources) that the topic draws readers: a timestamp in the system prompt multiplying the bill ([dev.to](https://dev.to/speed_engineer/a-timestamp-in-your-system-prompt-is-multiplying-your-llm-bill-1562)); hit rate falling from 100% to 40% from one injected timestamp ([dev.to](https://dev.to/alex_spinov/prompt-cache-break-hit-rate-fell-100-to-40-in-40-lines-21mm)); a nondeterministic system prompt as "the silent 10x tax" ([dev.to](https://dev.to/hexisteme/the-silent-10x-tax-how-a-nondeterministic-system-prompt-voids-your-llm-prompt-cache-39j5)); caching failing silently below the minimum token count ([dev.to](https://dev.to/creeta/claudes-prompt-cache-fails-silently-below-1024-tokens-1ch1)).

**Why compression differs from caching (and conflicts with it).** Compression (LLMLingua, leanctx, itaides/leanprompt) rewrites prompt text to send fewer tokens. Caching sends the *same* bytes so the provider or server reuses stored prefill. Compression that varies by request, or that runs on the stable prefix, changes the bytes, so it can destroy a cache hit that was already worth roughly 90% off input on Anthropic, and more in latency. Compression trades accuracy for tokens (leanctx reports a 1.8 pp loss); caching is lossless. leanprompt should state the rule plainly: cache the stable prefix first, and compress only the volatile tail, if at all. Projects in this space tend to blur the two, so a clear explainer is itself a gap.

## 3. Linters and analyzers for LLM app code

| Project | Stars / last push | What it is | Lesson | Overlap |
|---|---|---|---|---|
| [llmdoctor (PyPI)](https://pypi.org/project/llmdoctor/) 0.2.5 | PyPI | "Find LLM cost leaks before your bill does." Static analysis of Python Anthropic and OpenAI code: missing `max_tokens` on OpenAI, `max_tokens` above 8000, LangChain `ChatOpenAI()` without a limit. Silent if the SDKs are not imported directly | Closest static analyzer. Narrow (Python, two SDKs), no cache-layout rules, no score | **High** on the audit part |
| [pgy763/llm-lint](https://github.com/pgy763/llm-lint) | 1 / 2026-11-07 | Java (Spring AI and LangChain4j) static analysis, 22 rules, SARIF, GitHub Action; each rule links to a pitfalls handbook with a bad sample | **Rule ID, then explanation, then handbook link, plus `--explain`** is the pattern for audit findings | Medium (Java, reliability-focused) |
| [Specification and Detection of LLM Code Smells (arXiv 2512.18020)](https://arxiv.org/html/2512.18020v1); SpecDetect4LLM ([arXiv 2605.22976](https://arxiv.org/pdf/2605.22976.pdf)) | Papers | Academic catalogue of LLM code smells: unbounded tokens, timeouts, retries | Cite as the backing for rules; academic, not adopted | Supports the audit |
| [overllm (PyPI)](https://pypi.org/project/overllm) | PyPI | Flags LLM calls that plain code could replace | "Do you need an LLM call at all" is a real waste category; add it | Medium |
| aiproof-cli rule [AIP009](https://docs.rs/crate/aiproof-cli/0.1.3/source/rules_docs/AIP009.md) | crates.io | One rule on prompt structures that underuse caching | Others are adding cache rules one by one | Low |
| [toi-cyber/semgrep-llm-security](https://github.com/toi-cyber/semgrep-llm-security), [lintai](https://pypi.org/project/lintai/) | 0 / PyPI | Security-focused LLM static analysis (OWASP) | Security is covered; **cost and latency are not** | None |
| [krishalivaibhav/llm-cost-audit](https://github.com/krishalivaibhav/llm-cost-audit), [aswan97/llm-cost-auditor](https://github.com/aswan97/llm-cost-auditor) | 0 | Log-based cost audits (caching, batching, serving) | Many people have built this; none has traction, which suggests an untaken lane rather than no demand | Medium |

No widely adopted cost and latency linter for LLM app code exists. Everything found has fewer than five stars, is limited to one language, or is security-focused.

## 4. Existing "leanprompt" names

| Name | What | Activity | Collision |
|---|---|---|---|
| [itaides/leanprompt](https://github.com/itaides/leanprompt) | Zero-dependency **prompt compression** for LLM apps; TS, Rust and Go SDKs; README says `npm install leanprompt` and `cargo add leanprompt` | 0 stars, created 2026-07-27, pushed **today** (2026-11-22), CI | **Highest risk.** Same audience (LLM-app cost) and a technique that fights caching. Its npm and crates packages are not yet published (both 404 today) but could be at any moment |
| [WinM2M/leanprompt](https://github.com/WinM2M/leanprompt) (+ `leanprompt-client`) | FastAPI LLM framework with "session-based context caching" and output guards | 0 stars, pushed 2026-10-15 | **Owns PyPI `leanprompt`** (v0.4.4). It also says "caching", which adds to the confusion |
| [Adi-gyt/leanprompt](https://github.com/Adi-gyt/leanprompt) | VS Code extension, "stop burning tokens" (Marketplace `stillbuild.leanprompt`) | 1 star, pushed 2026-04-11 | Medium: same "token waste" message, different audience |
| [IvicaV/LeanPrompts](https://github.com/IvicaV/LeanPrompts) | Browser-extension prompt-template IDE, site leanprompts.app, AGPL | 3 stars, pushed 2026-11-21 | Low to medium: owns the leanprompts.app domain |
| Also nearby | [jia-gao/leanctx](https://github.com/jia-gao/leanctx) (compression, on PyPI as `leanctx`) | 324 stars | "lean" plus prompt-cost is already a crowded prefix |

Registry status today: npm `leanprompt` is free (404), crates `leanprompt` is free (404), PyPI `leanprompt` is **taken**. `kvsig` is free on PyPI; [Podwarden/kvsig](https://github.com/Podwarden/kvsig) is public with 0 stars. *(Update 2026-11-25: kvsig 0.1.0 has since been published on PyPI as `kvsig` and on npm as `@kvsig/core`.)*

## Top 5 lessons

1. **Lead with a measured number and a before/after.** caveman (benchmarks in the hero), cache-tax (a recorded $6.61 GIF) and leanctx (committed per-item data) all show proof above the fold. For leanprompt: a real repo audited, with its waste score, hit rate and $/month before and after, all reproducible through kvsig.
2. **Name the enemy in one memorable word.** "Slop" (unslop) and "many token" (caveman) did the marketing. leanprompt needs an equivalent for paying for the same prefill again and again, for example "prefill tax", "cache busters" or "re-reading the same 40k tokens".
3. **One-command install for every agent.** Claude Code plugin marketplace, a Codex `$skill-installer` URL, a claude.ai zip, an AGENTS.md snippet, and a Cursor rules export. Follow the anthropics/skills `skills/<name>/SKILL.md` layout (Agent Skills format).
4. **Rules need IDs, reasons and links, plus a CI gate.** llm-lint's rule-ID, explanation and handbook-link pattern, CacheLens's threshold gate, and llm-cost-audit's "no claim without measurement" protocol. Awesome-list curators reward tests and evals, so ship eval fixtures (good and bad sample apps).
5. **Be provider-neutral where the official material is not.** Anthropic's own skill already covers Anthropic caching well. The value is the cross-provider map (Anthropic explicit breakpoints, OpenAI automatic caching and `prompt_cache_key`, Gemini implicit and explicit CachedContent, vLLM APC, SGLang radix, llama.cpp slots) plus the generation side, which none of them cover.

## Gaps leanprompt can own

- **The app's bill, not the agent's bill.** Every viral token project optimises the coding session. Nobody packages "make the LLM app you are writing cheap" as agent skills.
- **A static audit with a single waste score across both prefill and generation.** Existing tools are either runtime or log-based (frugon, litellm, Langfuse), single-rule (aiproof), single-language (llmdoctor for Python, llm-lint for Java), or abandoned (CacheLens).
- **The generation side.** n samples in place of N calls, batch APIs, `max_tokens` and thinking budgets, stop sequences, retry storms that re-pay the full prefill, and calls that need no LLM at all. Almost nothing covers it.
- **Self-hosted cache hits.** How to lay out prompts so vLLM or SGLang prefix caching and cache-aware routing actually hit. That is LM Warden's natural home and no app-author guide exists.
- **An open, vendor-neutral measurement.** Hit rate and prefix stability are measured differently by each vendor; kvsig can be the common yardstick for "before and after". Nobody else offers one.
- **A clear caching-versus-compression doctrine.** Cache first, compress only the volatile tail. The field blurs the two, and one of the namesakes ships compression under our name.

## Positioning recommendation

"Skills that make the LLM apps your coding agent writes cheaper and faster: the prefill you stop paying for, the tokens you stop generating, and a waste score to prove it." Keep it provider-neutral and honest about trade-offs, in the style of the "no claim without a log" protocol. Present LM Warden as the reference self-hosted target and the place the audit's "self-hosted" track points to, not as a requirement. Vendor-authored skill repos (Vercel, Anthropic) show that this earns trust when the skills are useful without the product. Distribute through awesome-claude-skills, awesome-claude-code (Usage & Cost), awesome-ai-tokenomics and the openai/skills curated list, and launch with a social series of real audits, as unslop did.

## Naming risk

**Medium to high.** Four GitHub repos already use the name; one (itaides) is an *actively developed prompt-compression library for the same audience*, which teaches the technique leanprompt warns against, and its README already claims `npm install leanprompt` and `cargo add leanprompt`. PyPI `leanprompt` is taken by a FastAPI framework that also advertises "context caching". leanctx (324 stars) sits nearby. Search results and package installs will be ambiguous from day one.

Options: (a) keep the name but publish under an owned scope (`Podwarden/leanprompt`, npm `@podwarden/leanprompt`), never claim PyPI, and decide whether to take unscoped npm `leanprompt` now before itaides does; (b) rename to something that carries the cache angle and is unclaimed, such as "prefill-tax", "cachewise" or "warmprefix" (availability **not yet checked**); or (c) pair the name with a qualifier everywhere ("leanprompt skills"). Recommendation: decide before the first public post, because a rename after launch costs the stars and links. If the name stays, the first README line must say "skills for coding agents, not a compression library".
