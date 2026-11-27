"""Nightly refresh: summarise every source page that changed since the last run."""
import hashlib
import json
from pathlib import Path

from openai import OpenAI

client = OpenAI(timeout=60, max_retries=2)
STATE = Path("state.json")


def content_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def summarise(text: str) -> str:
    resp = client.chat.completions.create(
        model="example-small",
        messages=[{"role": "system", "content": "Summarise the page in five lines."}, {"role": "user", "content": text}],
        max_completion_tokens=400,
    )
    choice = resp.choices[0]
    if choice.finish_reason == "length":
        raise RuntimeError("summary cut off")
    return choice.message.content


def refresh(sources: list[Path]) -> None:
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    for src in sources:
        text = src.read_text()
        if state.get(str(src)) == content_key(text):
            continue
        Path("out", src.name).write_text(summarise(text))
        state[str(src)] = content_key(text)
    STATE.write_text(json.dumps(state))
