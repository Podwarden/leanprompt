---
id: LP-PD-04
title: Trim tool results and retrieved context at the tool boundary
skill: prompt-diet
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, sglang, any]
saves: prefill
severity: high
evidence:
  - E11
  - doc: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
---
## Rule
Before a tool result or a retrieved document enters the prompt, cut it to what the model needs for the task: select the fields, cap the rows and the length, and summarise long text, in the code that runs the tool, so the smaller version is the only one the history ever holds.

## Why
A tool that returns a whole API response, a database row with every column, a web page with its markup, or ten retrieved chunks where two answer the question, puts all of it into the prompt. Anthropic counts `tool_result` blocks as input tokens ([providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.12/providers/anthropic.md)). In an agent loop the result stays in the history, so it is paid once uncached on the next call and then on every later call of the conversation, read from the cache or, after the cache lifetime, at the full price again ([providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.12/providers/openai.md)). Large results also push conversations into compaction sooner (LP-PC-08). Documented, not yet measured here.

The boundary matters for the cache. Trim when the result is first added: the trimmed text then never changes, and the history stays append-only. Shortening a result later, after it has been sent, rewrites the history and loses the cached prefix from that point (LP-PC-06).

## Detect in code
Python:
```
rg -n '"content":\s*(json\.dumps\()?(resp|response|result|data|r)\.(json\(\)|text|content)\b|tool_result' -g '*.py'
rg -n 'similarity_search\(|\.query\(.*(top_k|k)\s*=\s*\d{2,}|as_retriever\(' -g '*.py'
```
Shapes: `{"type": "tool_result", "content": json.dumps(resp.json())}` with the raw response; `requests.get(url).text` (HTML) passed as a tool result; `top_k=20` retrieval joined into the prompt with no cap on length; a SQL tool that returns `SELECT *`.

TS/JS:
```
rg -n 'content:\s*(JSON\.stringify\()?(await \w+\.(json|text)\(\)|res(ponse)?\.data|result)\b' -g '*.{ts,tsx,js,mjs}'
rg -n 'topK:\s*\d{2,}|similaritySearch\(' -g '*.{ts,tsx,js,mjs}'
```
Shapes: an MCP tool handler that returns the upstream payload as text; `role: "tool", content: JSON.stringify(data)` with the full object.

Go:
```
rg -n 'io\.ReadAll\(|json\.Marshal\((resp|result|data)\)' -g '*.go'
```
Shapes: a tool handler that returns `string(body)` from `io.ReadAll(resp.Body)` with no field selection or limit.

## Fix
```python
# before: the whole response goes into the history
def get_order(order_id):
    return requests.get(f"{API}/orders/{order_id}", timeout=10).json()     # dozens of fields, nested

messages.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": json.dumps(get_order(oid))}]})

# after: the tool returns what the task needs, with a cap, decided once at the boundary
ORDER_FIELDS = ("id", "status", "items", "total", "shipped_at")
MAX_ITEMS = 20

def get_order(order_id):
    raw = requests.get(f"{API}/orders/{order_id}", timeout=10).json()
    out = {k: raw[k] for k in ORDER_FIELDS if k in raw}
    if len(out.get("items", [])) > MAX_ITEMS:
        out["items"] = out["items"][:MAX_ITEMS]
        out["items_truncated"] = True                                       # tell the model, so it can ask for more
    return out
```

For retrieval, cap the number of chunks and their total length, and drop near-duplicate chunks before they are joined into the prompt. For long text the model only needs the gist of, summarise it in the tool (a small model can do it) and offer a follow-up tool to fetch the full text when it is needed.

## Don't break meaning
The field the model needs is sometimes the one you would cut. Choose the fields from what the app's answers use (read the prompts and the outputs), say in the result when it was cut, and give the model a way to get more (a page argument, a "full" flag). Run the answer check with `measure-loop` on a fixed set of inputs that exercise each tool, before and after: answers unchanged or better, and no new extra tool calls to fetch what was cut; extra calls cost more than they save. Do not trim tool results already in the history, and do not strip the model's reasoning about them: stripping reasoning made agents redo the work: about 3x more generation (E11). These results are not part of the shared head, so trimming them at the boundary does not break any other call's cache. The append-only history this relies on: [prefill-cache](../../prefill-cache/SKILL.md) (LP-PC-06).

## Verify
(a) Provider usage: on the call after a tool runs, the uncached input (`input_tokens` minus `cache_read_input_tokens` on Anthropic, `prompt_tokens` minus `cached_tokens` on OpenAI) falls by about the size cut from the result; on later turns `prompt_tokens` stays lower by the same amount. The number of tool calls per task does not rise.

(b) leanprompt usage record: `prompt_tokens` per turn of agent conversations falls; `cached_tokens` on the next turn still covers everything up to the new result (the history stays append-only, `ids.nodes` of earlier messages unchanged).

## Waste signal
Measured: the drop in `prompt_tokens` per turn times the turns after each tool call; the score does not count it, the report shows it as `tokens_per_1k.prompt`. Static: severity high for raw API responses, HTML pages or `SELECT *` results put whole into an agent loop's history; medium for retrieval with no cap on chunks or length; low for a few unused fields.
<!-- leanprompt:generated v0.1.0-dev.12: written by leanprompt install; leanprompt update replaces local edits -->
