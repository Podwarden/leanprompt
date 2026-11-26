"""Nightly tagging job and conversation titles."""
from openai import OpenAI

client = OpenAI()
MODEL = "gpt-5"
LABELS = ["billing", "bug", "feature", "other"]


def classify(text: str) -> str:
    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=10,
        messages=[{"role": "user", "content": f"Label as one of {LABELS}: {text}"}],
    )
    return resp.choices[0].message.content.strip()


def nightly(rows) -> None:
    for row in rows:
        row.label = classify(row.text)
        row.save()


def generate_title(history: list) -> str:
    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=20,
        messages=history + [{"role": "user", "content": "Give this chat a 4-word title."}],
    )
    return resp.choices[0].message.content
