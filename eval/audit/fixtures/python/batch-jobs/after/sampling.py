"""Self-consistency answers for a quiz app."""
from collections import Counter

from openai import AsyncOpenAI

client = AsyncOpenAI()
MODEL = "gpt-5"


async def majority_answer(question: str, k: int = 5) -> str:
    # One request, k samples: the prompt is prefilled once.
    resp = await client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": question}],
        temperature=0.8,
        reasoning_effort="low",
        max_completion_tokens=400,
        n=k,
    )
    answers = [c.message.content for c in resp.choices]
    return Counter(answers).most_common(1)[0][0]
