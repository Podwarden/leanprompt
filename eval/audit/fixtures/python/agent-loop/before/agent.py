"""A small tool-using agent over an OpenAI-compatible endpoint."""
import json
import os

from openai import OpenAI

client = OpenAI(base_url="https://llm.example.internal/v1", api_key="unused")
MODEL = "example-chat-70b"

REGISTRY = {}


def tool(fn):
    REGISTRY[fn.__name__] = fn
    return fn


@tool
def read_note(note_id: str) -> str:
    return open(f"notes/{note_id}.txt").read()


@tool
def search_notes(query: str) -> str:
    return "\n".join(p for p in os.listdir("notes") if query in p)


def schemas(names=None):
    return [t.schema for n, t in REGISTRY.items() if names is None or n in names]


def relevant_tools(message: str):
    return schemas([n for n in REGISTRY if n.split("_")[0] in message])


def to_api(row):
    return {"role": row["role"], "content": row["content"].strip()}


def summarise(history):
    out = client.chat.completions.create(
        model=MODEL,
        messages=history + [{"role": "user", "content": "Summarise this conversation."}],
    )
    return out.choices[0].message.content


def run(conv_id: str, db, user_message: str, hard: bool) -> str:
    history = [to_api(r) for r in db.load(conv_id)]
    history.append({"role": "user", "content": user_message})
    if len(history) > 40:
        system = "You are a notes agent.\n\nEarlier conversation:\n" + summarise(history)
        history = history[-6:]
    else:
        system = "You are a notes agent."
    while True:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "system", "content": system}] + history,
            tools=relevant_tools(user_message),
            extra_body={"chat_template_kwargs": {"enable_thinking": hard}},
        )
        msg = resp.choices[0].message
        if not msg.tool_calls:
            return msg.content
        history.append({"role": "assistant", "content": msg.content, "tool_calls": msg.tool_calls})
        for call in msg.tool_calls:
            result = REGISTRY[call.function.name](**json.loads(call.function.arguments))
            history.append({"role": "tool", "tool_call_id": call.id, "content": result[:2000]})
