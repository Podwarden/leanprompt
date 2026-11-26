"""Support assistant for a fictional note-taking app."""
import os
import platform
from datetime import datetime

import anthropic

client = anthropic.Anthropic()

HANDBOOK = open("handbook.md").read()


def build_system(user) -> str:
    return (
        f"Current time: {datetime.now().isoformat()}\n"
        f"Running in {os.getcwd()} on {platform.platform()}\n"
        f"You are assisting {user.name} ({user.plan}).\n"
        f"{HANDBOOK}"
    )


def answer(user, history: list, question: str) -> str:
    history.append({"role": "user", "content": question})
    resp = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1024,
        system=build_system(user),
        messages=history,
    )
    text = resp.content[0].text
    history.append({"role": "assistant", "content": text})
    return text
