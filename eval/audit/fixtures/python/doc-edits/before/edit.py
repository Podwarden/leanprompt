"""Edit documents with a model; fictional docs service."""
import random
import time
from pathlib import Path

import boto3
from openai import OpenAI
from tenacity import retry, stop_after_attempt

MODELS = ["example-large-a", "example-large-b"]
s3 = boto3.client("s3")
client = OpenAI(base_url="https://router.example.net/api/v1", timeout=15, max_retries=2)


@retry(stop=stop_after_attempt(4))
def call(model: str, messages: list):
    resp = client.chat.completions.create(model=model, messages=messages, max_tokens=8000)
    if resp.choices[0].finish_reason == "length":
        return call(model, messages)
    return resp.choices[0].message.content


def edit_file(path: str, instruction: str, image_key: str) -> None:
    url = s3.generate_presigned_url("get_object", Params={"Bucket": "docs", "Key": image_key})
    messages = [
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": url}},
            {"type": "text", "text": f"Return the full file after this change: {instruction}\n\n{Path(path).read_text()}"},
        ]},
    ]
    Path(path).write_text(call(random.choice(MODELS), messages))


def edit_all(paths, instruction: str, image_key: str) -> None:
    for p in paths:
        edit_file(p, instruction, image_key)
        time.sleep(400)
