"""Edit documents with a model; fictional docs service."""
import time
from pathlib import Path

import boto3
from openai import OpenAI

MODEL = "example-large-a"
s3 = boto3.client("s3")
client = OpenAI(base_url="https://router.example.net/api/v1", timeout=300, max_retries=0)
RETRYABLE = (TimeoutError, ConnectionError)
_image_cache: dict = {}


def image_url(key: str) -> str:
    # Same URL for every request, so the prefix stays identical.
    if key not in _image_cache:
        _image_cache[key] = s3.generate_presigned_url(
            "get_object", Params={"Bucket": "docs", "Key": key}, ExpiresIn=86400)
    return _image_cache[key]


def call(messages: list, prediction: str):
    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model=MODEL, messages=messages, max_tokens=8000,
                prediction={"type": "content", "content": prediction}, stream=True)
        except RETRYABLE:
            time.sleep(2 ** attempt)
            continue
        text = "".join(c.choices[0].delta.content or "" for c in resp)
        return text
    raise RuntimeError("model unavailable")


def edit_file(path: str, instruction: str, image_key: str) -> str:
    body = Path(path).read_text()
    messages = [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": image_url(image_key)}},
        {"type": "text", "text": f"Return the full file after this change: {instruction}\n\n{body}"},
    ]}]
    return call(messages, prediction=body)


def edit_all(paths, instruction: str, image_key: str) -> None:
    for p in paths:
        Path(p).write_text(edit_file(p, instruction, image_key))
