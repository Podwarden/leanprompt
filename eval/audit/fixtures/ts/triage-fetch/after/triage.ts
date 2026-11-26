// Ticket triage for a fictional support desk. Talks to an OpenAI-compatible server
// (for example POST /v1/chat/completions) chosen from settings; the base URL ends in /v1.
const BASE = process.env.LLM_BASE_URL ?? "https://llm.example.test/v1";
const MODEL = process.env.LLM_MODEL ?? "triage-model";

const SCHEMA = {
  type: "object",
  properties: { queue: { type: "string" }, urgent: { type: "boolean" } },
  required: ["queue", "urgent"],
  additionalProperties: false,
};

export async function triage(ticket: string): Promise<{ queue: string; urgent: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LLM_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: ticket }],
        response_format: { type: "json_schema", json_schema: { name: "triage", strict: true, schema: SCHEMA } },
      }),
    });
    if (res.status === 429 || res.status >= 500) continue; // retry only what can succeed on a retry
    if (!res.ok) throw new Error(`triage failed: ${res.status}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return JSON.parse(data.choices[0].message.content);
  }
  throw new Error("triage failed");
}
