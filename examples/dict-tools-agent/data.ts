// Twelve tools and eight requests, each of which names exactly one tool.

import { policyText, shuffled, type ToolDef } from "../common.js";

interface Spec {
  name: string;
  summary: string;
  props: string[];
  task: string;
}

const SPECS: Spec[] = [
  { name: "search_orders", summary: "Find orders by customer or date.", props: ["customer", "from", "to", "status"], task: "find every order Ana Silva placed last week" },
  { name: "get_invoice", summary: "Fetch one invoice as text.", props: ["invoice_id", "format"], task: "read invoice INV-2291" },
  { name: "refund_payment", summary: "Refund a captured payment.", props: ["payment_id", "amount", "reason"], task: "refund payment PAY-88 in full" },
  { name: "update_address", summary: "Change the delivery address of an open order.", props: ["order_id", "street", "city", "postcode"], task: "change the delivery address of order 5521" },
  { name: "track_parcel", summary: "Show where a parcel is.", props: ["tracking_number", "carrier"], task: "see where parcel 1Z99 is" },
  { name: "list_products", summary: "List catalogue products.", props: ["category", "limit", "offset"], task: "list the first 20 products in the lamps category" },
  { name: "check_stock", summary: "Report stock for one product.", props: ["sku", "warehouse"], task: "check how many units of SKU L-204 are in stock" },
  { name: "send_email", summary: "Send an email to a customer.", props: ["to", "subject", "body"], task: "email a customer that their order has shipped" },
  { name: "create_ticket", summary: "Open a support ticket.", props: ["title", "priority", "assignee"], task: "open a high-priority ticket about a late delivery" },
  { name: "close_ticket", summary: "Close a support ticket.", props: ["ticket_id", "resolution"], task: "close ticket T-4410 as resolved" },
  { name: "get_customer", summary: "Fetch a customer record.", props: ["customer_id", "email"], task: "look up the customer with email ana@example.com" },
  { name: "export_report", summary: "Export a sales report.", props: ["period", "format", "region"], task: "export last month's sales report for the north region" },
];

const detail = (s: Spec): string =>
  [`Use ${s.name} only when the request is about this subject.`, `Pass ${s.props.join(", ")} as text; leave out any value the user did not give.`, `The result is plain text. If it is empty, say so instead of guessing.`, `Do not call ${s.name} twice in a row with the same arguments.`]
    .join(" ")
    .repeat(3);

/** Registers the tools the way a plugin loader would: in whatever order they arrive. */
export function register(next: () => number): Record<string, ToolDef> {
  const registry: Record<string, ToolDef> = {};
  for (const s of shuffled(SPECS, next)) {
    const properties = Object.fromEntries(shuffled(s.props, next).map((p) => [p, { type: "string", description: `The ${p} value.` }]));
    registry[s.name] = { name: s.name, description: `${s.summary} ${detail(s)}`, parameters: { type: "object", properties, required: [s.props[0]] } };
  }
  return registry;
}

export const SYSTEM = `You are an operations assistant for a home-goods shop. Pick the one tool that fits the request.\n${policyText(60)}`;

export const TURNS = [0, 2, 4, 6, 7, 9, 10, 11].map((i) => ({
  input: `I need to ${SPECS[i].task}. Reply with the name of the single best tool and nothing else.`,
  expect: SPECS[i].name,
}));
