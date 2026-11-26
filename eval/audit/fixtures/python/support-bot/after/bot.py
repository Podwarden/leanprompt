"""Support assistant for a fictional note-taking app."""
import anthropic

client = anthropic.Anthropic()

HANDBOOK = open("handbook.md").read()
SYSTEM = [{"type": "text", "text": HANDBOOK, "cache_control": {"type": "ephemeral"}}]


def answer(user, history: list, question: str) -> str:
    # Shared handbook first and marked; per-user facts ride in the newest message.
    context = f"[user: {user.name}, plan: {user.plan}]\n{question}"
    history.append({"role": "user", "content": context})
    resp = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1024,
        system=SYSTEM,
        messages=history,
    )
    text = resp.content[0].text
    history.append({"role": "assistant", "content": text})
    return text
