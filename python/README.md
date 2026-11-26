# leanprompt-cli

The usage logger for Python apps, part of [leanprompt](https://github.com/Podwarden/leanprompt)
by the LM Warden Team. leanprompt gets more from every LLM call your app makes: its skills teach
AI coding assistants to make prompts cacheable, cut dead weight, stop wasted output and speed up
first tokens, without changing the answers; it is not a prompt-compression library. The main tool is
the npm package (`npx leanprompt init`); this package is the Python side of its measure loop.

The logger writes one JSON line per LLM call to a usage log. `npx leanprompt score` reads that
log and gives a measured score for how well the app's prompts reuse the provider's cache.

## Install

```
pip install leanprompt-cli
```

It depends on [kvsig](https://pypi.org/project/kvsig/) 0.1.0, which computes the keyed prompt ids.

## Use

```python
import os
from openai import OpenAI
from leanprompt_cli import Logger

key_bytes = bytes.fromhex(os.environ["LEANPROMPT_KEY"])  # 32 random bytes, generated once, kept out of the repo
logger = Logger(".leanprompt/usage.jsonl", key_bytes, "openai", "gpt-x")

client = OpenAI()
body = {"model": "gpt-x", "messages": [{"role": "system", "content": "You are a support assistant."},
                                       {"role": "user", "content": "Where is my order?"}]}
response = client.chat.completions.create(**body)

# after each call:
logger.log("openai.chat", body, response.usage, finish=response.choices[0].finish_reason)
```

`log()` accepts the SDK's usage object as it comes (OpenAI and Anthropic pydantic models,
google-genai `usage_metadata`) or a plain dict. It returns the record's index in the file, the
value to pass as `retry_of=` when you retry that call; set `parse_failed=True` when your parser
rejects an answer. It never raises into your request path: if anything goes wrong, nothing is
written and it returns `None`.

The `provider` argument decides which cache facts score the call: name where the request is
served (`openai`, `anthropic`, `gemini`, `openrouter`, `deepinfra`, or `vllm`, `sglang`,
`lm-warden` for a self-hosted server), not the SDK that sends it.

## What is written, and what is not

Each line holds: a timestamp, the provider and model names, the request dialect, kvsig ids
(keyed hashes of the conversation, the system prompt and tools, and each prefix), cumulative
character counts, the cache breakpoint positions, a keyed hash of the sampling parameters, the
token counts (prompt, cached, cache write, output), the finish reason and the retry and parse
flags.

It never writes prompt text, completion text, tool arguments or the key. The ids are keyed, so
without the key they cannot be matched against a guessed prompt. It makes no network calls.

## More

- How to log, replay a session and keep the fix in CI: the
  [measure-loop skill](https://github.com/Podwarden/leanprompt/blob/main/skills/measure-loop/SKILL.md).
- The repository, license and issues: https://github.com/Podwarden/leanprompt

Apache-2.0.
