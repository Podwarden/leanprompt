// A support agent with a long handbook-style system prompt and one tool. Each session states four
// facts about a ticket (turns 1-4); the conversation is then compacted; four later questions
// (turns 5-8) can only be answered from what the summary kept.

import { policyText, type ToolDef } from "../common.js";

/** The stable system prompt, including how to read a summary. */
export const BASE = [
  "You are a support agent for a home-goods shop. Answer in as few words as the question allows.",
  "When you are given a summary of the conversation so far, treat what it records as things the customer already told you.",
  policyText(110),
].join("\n");

export const TOOLS: ToolDef[] = [
  {
    name: "lookup_order",
    description: "Look up an order by its code and return its status as plain text.",
    parameters: { type: "object", properties: { order_code: { type: "string", description: "The order code, for example ORD-1234." } }, required: ["order_code"] },
  },
];

/** The conversation is compacted once this many turns have been answered. */
export const COMPACT_AFTER = 4;

/** The request that makes the model write the summary; the same text in both forms. */
export const SUMMARISE = "Summarise the conversation so far for your own later use, keeping every fact the customer gave. Do not call a tool.";

const FACTS = [
  { say: "For this ticket the courier is Hartwell Freight. Reply with the courier name only.", expect: "Hartwell" },
  { say: "The delivery dock is D-41. Reply with the dock code only.", expect: "D-41" },
  { say: "The order code is ORD-5312. Reply with the order code only.", expect: "ORD-5312" },
  { say: "The customer can receive the parcel on Thursday. Reply with the day only.", expect: "Thursday" },
];
const RECALL = [
  { say: "Which order code did we note for this ticket? Reply with the code only.", expect: "ORD-5312" },
  { say: "Which dock did we note for this ticket? Reply with the code only.", expect: "D-41" },
  { say: "On which day can the customer receive the parcel? Reply with the day only.", expect: "Thursday" },
  { say: "Which courier did we note for this ticket? Reply with the name only.", expect: "Hartwell" },
];

export const TURNS = [...FACTS, ...RECALL].map((t) => ({ input: t.say, expect: t.expect }));

/** What the model's summary says in a replay: all four facts. */
export const CANNED_SUMMARY = "Courier Hartwell Freight; dock D-41; order ORD-5312; parcel can be received on Thursday.";
