"""Nightly tagging job and conversation titles."""
import hashlib
import json

from openai import OpenAI

client = OpenAI()
MODEL = "gpt-5"
SMALL_MODEL = "gpt-5-mini"
LABELS = ["billing", "bug", "feature", "other"]


def build_batch(rows) -> str:
    """Write a Batch API input file for rows whose text changed since the last run."""
    path = "batch_input.jsonl"
    with open(path, "w") as f:
        for row in rows:
            if row.text_hash == hashlib.sha256(row.text.encode()).hexdigest():
                continue
            body = {
                "model": SMALL_MODEL,
                "max_tokens": 10,
                "messages": [{"role": "user", "content": f"Label as one of {LABELS}: {row.text}"}],
            }
            f.write(json.dumps({"custom_id": str(row.id), "method": "POST",
                                "url": "/v1/chat/completions", "body": body}) + "\n")
    return path


def submit(path: str) -> str:
    uploaded = client.files.create(file=open(path, "rb"), purpose="batch")
    job = client.batches.create(
        input_file_id=uploaded.id, endpoint="/v1/chat/completions", completion_window="24h"
    )
    return job.id


def generate_title(history: list) -> str:
    resp = client.chat.completions.create(
        model=SMALL_MODEL,
        max_tokens=20,
        messages=history[:2] + [{"role": "user", "content": "Give this chat a 4-word title."}],
    )
    return resp.choices[0].message.content
