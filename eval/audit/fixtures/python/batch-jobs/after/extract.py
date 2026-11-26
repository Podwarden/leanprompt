"""Pull fields out of support tickets."""
import json

from openai import OpenAI

client = OpenAI()
MODEL = "gpt-4.1"
SCHEMA = {
    "type": "object",
    "properties": {
        "customer_name": {"type": "string"},
        "product": {"type": "string"},
        "order_number": {"type": "string"},
        "refund_requested": {"type": "boolean"},
    },
    "required": ["customer_name", "product", "order_number", "refund_requested"],
    "additionalProperties": False,
}


def extract_all(ticket: str) -> dict:
    # One call answers every field and the schema guarantees valid JSON.
    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=200,
        messages=[{"role": "user", "content": ticket}],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "ticket", "strict": True, "schema": SCHEMA},
        },
    )
    return json.loads(resp.choices[0].message.content)
