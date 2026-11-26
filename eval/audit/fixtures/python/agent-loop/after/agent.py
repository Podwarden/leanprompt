"""A small tool-using agent over an OpenAI-compatible endpoint."""
import json
import os

from openai import OpenAI

client = OpenAI(base_url="https://llm.example.internal/v1", api_key="unused")
MODEL = "example-chat-70b"

TOOL_ORDER = ["read_note", "search_notes"]  # fixed order; new tools are appended


def read_note(note_id: str) -> str:
    return open(f"notes/{note_id}.txt").read()


def search_notes(query: str) -> str:
    return "\n".join(sorted(p for p in os.listdir("notes") if query in p))


FUNCS = {"read_note": read_note, "search_notes": search_notes}
TOOLS = [FUNCS[n].schema for n in TOOL_ORDER]
SYSTEM = "You are a notes agent."


def run(conv_id: str, db, user_message: str) -> str:
    # Rows are stored exactly as sent, so history is append-only.
    history = db.load_raw(conv_id)
    history.append({"role": "user", "content": user_message})
    while True:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "system", "content": SYSTEM}] + history,
            tools=TOOLS,
            extra_body={"chat_template_kwargs": {"enable_thinking": True}},
        )
        msg = resp.choices[0].message
        db.append_raw(conv_id, msg)
        if not msg.tool_calls:
            return msg.content
        history.append(msg)
        for call in msg.tool_calls:
            result = FUNCS[call.function.name](**json.loads(call.function.arguments))
            history.append({"role": "tool", "tool_call_id": call.id, "content": result})
        # When history nears the limit, a separate job compacts it and keeps the
        # system prompt and tools unchanged.
