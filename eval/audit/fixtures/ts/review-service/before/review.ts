// Code-review helper for a fictional pull-request tool.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ timeout: 10_000 });
const RULES = "Follow the team style guide. Flag unsafe SQL. Prefer small functions.";

export async function reviewDiff(repoId: string, diff: string): Promise<unknown> {
  const system = `Now: ${new Date().toISOString()}\nRepo ${repoId}\n${RULES}`;
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: `Review as JSON {"issues": [...]}:\n${diff}` }],
  });
  const block = msg.content[0];
  const text = block.type === "text" ? block.text : "";
  try {
    return JSON.parse(text);
  } catch {
    return reviewDiff(repoId, diff + "\nYour last answer was not valid JSON.");
  }
}
