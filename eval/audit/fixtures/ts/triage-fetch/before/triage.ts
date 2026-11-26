// Ticket triage for a fictional support desk. Talks to an OpenAI-compatible server
// (for example POST /v1/chat/completions) chosen from settings; the base URL ends in /v1.
const BASE = process.env.LLM_BASE_URL ?? "https://llm.example.test/v1";
const MODEL = process.env.LLM_MODEL ?? "triage-model";

export async function triage(ticket: string): Promise<{ queue: string; urgent: boolean }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LLM_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: `Reply only with JSON {"queue": "...", "urgent": true|false}.\n${ticket}` }],
        }),
      });
      const data = (await res.json()) as { choices: { message: { content: string } }[] };
      return JSON.parse(data.choices[0].message.content);
    } catch {
      // retry on every failure, including a bad parse
    }
  }
  throw new Error("triage failed");
}
