---
id: LP-PC-03
title: No ids, timestamps, versions or paths at the top of the prompt
skill: prefill-cache
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang]
saves: prefill
severity: high
evidence: [E4, E5]
---
## Rule
Keep request and session ids, timestamps, version strings, hostnames and filesystem paths out of the first lines of the system prompt and out of tool definitions; put them in the newest user message, or at least after all the stable text.

## Why
Inside one session these values do not change, so the loss is across sessions: every new session, subagent, user or deploy pays for the whole head again, up to the first line that differs.

- A coding harness writes the working directory into its long system prompt. Across sessions in different directories a self-hosted vLLM reused only the 7,920 tokens before that line (E5).
- Another harness puts a per-session version suffix and the working directory on its first system line. Anthropic still reused 12,895 tokens across sessions, because it renders tools first and the tools were equal; a route that renders the system prompt first loses everything after line 1 (E4).

Render order decides how much survives: tools, then system, then messages on Anthropic ([providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md)); system before tools on OpenAI and DeepInfra as observed, not documented (render-order rows in [providers/openai.md](../../leanprompt/facts/providers/openai.md) and [providers/deepinfra.md](../../leanprompt/facts/providers/deepinfra.md)); on a self-hosted engine, whatever the model's chat template says. A path or id in a tool description breaks the tool block itself, which on Anthropic comes before everything else. Dates are the mild case (they change once a day; LP-PC-02); ids and timestamps change every session or every call.

## Detect in code
Python:
```
rg -n 'os\.getcwd\(|Path\.cwd\(|socket\.gethostname\(|platform\.(node|platform)\(|uuid\.uuid4\(|__version__|importlib\.metadata\.version\(' -g '*.py'
```
Shapes: `f"You are running in {os.getcwd()} on {platform.platform()}"` as the opening of the system prompt; `f"Session {session_id}. ..."`; a tool `description=f"Read files under {root}"`.

TS/JS:
```
rg -n 'process\.cwd\(|os\.hostname\(|crypto\.randomUUID\(|randomUUID\(|npm_package_version|pkg\.version|Date\.now\(' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `` `${AGENT_NAME} v${pkg.version} (${sessionId})\n` `` as the first system line; `` description: `Search ${process.cwd()}` ``.

Go:
```
rg -n 'os\.Getwd\(|os\.Hostname\(|uuid\.New(String)?\(|runtime\.Version\(|time\.Now\(\)|\bversion\b.*Sprintf' -g '*.go'
```
Shapes: `fmt.Sprintf("agent %s, cwd %s\n%s", version, wd, basePrompt)`; a `Tool{Description: "Files in " + root}`.

## Fix
Move the values into a labelled environment block in the first user message (best: the whole head stays equal across sessions), or at least to the end of the system prompt (the provider still reuses the bytes before it).

```python
# before
system = f"agent {VERSION} session {session_id}\nWorking directory: {os.getcwd()}\n{BASE_PROMPT}"
tools = [{"name": "read_file", "description": f"Read a file under {root}", ...}]

# after
system = BASE_PROMPT + "\n\nThe working directory and environment are given in the first user message."
tools = [{"name": "read_file", "description": "Read a file under the working directory", ...}]
env = f"<environment>\nWorking directory: {os.getcwd()}\n</environment>"
first_user = {"role": "user", "content": f"{env}\n\n{task}"}
```

```go
// before
sys := fmt.Sprintf("agent %s, cwd %s\n%s", version, wd, basePrompt)
// after
sys := basePrompt
first := fmt.Sprintf("<environment>\nWorking directory: %s\n</environment>\n\n%s", wd, task)
```

Keep the version out of the prompt entirely unless the model needs it; log it instead.

One way to keep this checkable, if the user wants it (optional, not part of the fix): a test in the app that builds the first request of two sessions (two directories, two versions) and asserts their kvsig `head` ids are equal catches the value coming back to the top of the prompt. [measure-loop](../../measure-loop/SKILL.md) ("The stable-head test") has a short example in TypeScript and Python and a helper; propose the test as its own small diff and add it only after the user says yes.

## Don't break meaning
The model still needs the value. Keep it labelled ("Working directory: ..."), and update any instruction that pointed at it by position ("the directory above"). A tool description that named a path must still be correct in general terms, with the concrete path given in the environment block. Run the app's answer check on a task that depends on the moved value.

## Verify
(a) Start two sessions that differ only in the moved value (two directories, two versions). The first request of the second session reports `cached_tokens` or `cache_read_input_tokens` covering the stable head.

(b) kvsig: the first requests of the two sessions have equal exact `tools` and `sys`, so equal `head`. If the value was moved only to the end of the system prompt, `sys` still differs: verify with (a) instead.

## Waste signal
Measured: the score's S counts only requests that continue an earlier one, so this cross-session loss shows mostly as many distinct `head` ids among the first requests of an app whose head should be one, and as a short shared prefix on each first request. Static: severity high for a per-session or per-call value in the first lines of the system prompt or in a tool definition.
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
