"""Self-consistency answers for a quiz app."""
import asyncio
from collections import Counter

from openai import AsyncOpenAI

client = AsyncOpenAI()
MODEL = "gpt-5"


async def ask_once(question: str) -> str:
    resp = await client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": question}],
        temperature=0.8,
        reasoning_effort="high",
    )
    return resp.choices[0].message.content


async def majority_answer(question: str, k: int = 5) -> str:
    answers = await asyncio.gather(*(ask_once(question) for _ in range(k)))
    return Counter(answers).most_common(1)[0][0]
