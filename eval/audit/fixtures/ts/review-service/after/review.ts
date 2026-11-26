// Code-review helper for a fictional pull-request tool.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ timeout: 120_000 });
const RULES = "Follow the team style guide. Flag unsafe SQL. Prefer small functions.";

export async function reviewDiff(repoId: string, diff: string): Promise<unknown> {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2000,
    system: [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } }],
    messages: [
      { role: "user", content: `Repo ${repoId} at ${new Date().toISOString()}\n\nReview this diff:\n${diff}` },
    ],
    tools: [
      {
        name: "report",
        description: "Report review issues",
        input_schema: {
          type: "object",
          properties: { issues: { type: "array", items: { type: "string" } } },
          required: ["issues"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "report" },
  });
  const block = msg.content.find((b) => b.type === "tool_use");
  return block && block.type === "tool_use" ? block.input : { issues: [] };
}
