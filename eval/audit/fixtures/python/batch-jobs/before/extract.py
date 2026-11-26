"""Pull fields out of support tickets."""
import json

from openai import OpenAI

client = OpenAI()
MODEL = "gpt-4.1"
FIELDS = ["customer name", "product", "order number", "refund requested"]


def ask(ticket: str, field: str) -> str:
    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=100,
        messages=[{"role": "user", "content": f"{ticket}\n\nWhat is the {field}?"}],
    )
    return resp.choices[0].message.content


def extract_all(ticket: str) -> dict:
    return {field: ask(ticket, field) for field in FIELDS}


def extract_json(ticket: str) -> dict:
    prompt = f"{ticket}\n\nRespond only with JSON with keys name, product, order."
    for _ in range(3):
        resp = client.chat.completions.create(
            model=MODEL, max_tokens=200, messages=[{"role": "user", "content": prompt}]
        )
        text = resp.choices[0].message.content
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            prompt += "\n\nThat was not valid JSON. Try again."
    raise ValueError("no valid JSON")
