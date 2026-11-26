// The shop handbook the assistant answers from, and the questions of the scenario.
// Everything is generated from the item number, so the questions and their answers cannot drift apart.

import { CLOCK_START, policyText } from "../common.js";

const KINDS = ["lamp", "kettle", "chair", "shelf", "rug", "clock", "mirror", "toaster"];
const FINISHES = ["brass", "oak", "slate", "linen", "copper", "ash", "walnut", "steel"];

export const returnDays = (i: number): number => 14 + ((i * 7) % 47);
export const warrantyMonths = (i: number): number => 6 + ((i * 5) % 31);
const itemId = (i: number): string => `B-${100 + i}`;

export const HANDBOOK = [
  "Shop handbook. Answer customer questions from the figures below.",
  ...Array.from({ length: 150 }, (_, i) => {
    const name = `${FINISHES[i % 8]} ${KINDS[(i * 3) % 8]}`;
    return `Item ${itemId(i)}, ${name}: return window ${returnDays(i)} days, warranty ${warrantyMonths(i)} months, ships from the Leeds depot within 2 working days.`;
  }),
  policyText(40),
].join("\n");

const ASKED = [3, 17, 29, 41, 58, 76, 92, 117];

/** Eight questions; the expected answer to each is one number. */
export const TURNS = ASKED.map((i, n) =>
  n % 2 === 0
    ? { input: `How many days is the return window for item ${itemId(i)}? Reply with the number only.`, expect: String(returnDays(i)) }
    : { input: `How many months of warranty does item ${itemId(i)} have? Reply with the number only.`, expect: String(warrantyMonths(i)) },
);

/** The date the app's clock shows (the default clock stays on this day for a whole run). */
const today = new Date(CLOCK_START);
const lastReturnDay = new Date(today.getTime() + returnDays(3) * 86_400_000).toISOString().slice(0, 10);

/** The ninth turn depends on today's date, which the model gets only from the app's date and time line. */
TURNS.push({
  input: `If I buy item ${itemId(3)} today, what is the last day I can return it? Reply as YYYY-MM-DD.`,
  expect: lastReturnDay,
});
