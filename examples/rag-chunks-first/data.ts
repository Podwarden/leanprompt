// A small parts catalogue, the chunks a retriever would return for a question, and the eight questions.
// Everything comes from the item number, so a question and its expected answer cannot drift apart.

import { policyText } from "../common.js";

const PARTS = ["valve", "bracket", "gasket", "hinge", "filter", "bearing", "spring", "coupling"];
const FINISHES = ["brass", "steel", "nylon", "bronze", "alloy", "rubber"];
const COUNT = 60;

export interface Chunk {
  id: string;
  text: string;
}

export const partCode = (i: number): string => `K-${200 + i}`;
/** A three-digit rating that is different for every part, so an answer from the wrong chunk shows. */
export const rating = (i: number): number => 100 + ((i * 37) % 900);
const chunk = (i: number): Chunk => ({
  id: `C-${i + 1}`,
  text: `Part ${partCode(i)}, ${FINISHES[i % 6]} ${PARTS[(i * 3) % 8]}: maximum working load ${rating(i)} kg, inspected every 12 months.`,
});

/**
 * The three chunks retrieved for part `i`: its own and two near neighbours, the right one in a
 * different place each time. `session` moves the neighbours, as a real retriever's would differ
 * between tickets.
 */
export function retrieve(i: number, session = 0): Chunk[] {
  const out = [chunk((i + 1 + session) % COUNT), chunk((i + 2 + session) % COUNT)];
  out.splice((i + session) % 3, 0, chunk(i));
  return out;
}

export const render = (chunks: Chunk[]): string => chunks.map((c) => `[${c.id}] ${c.text}`).join("\n");

/** The instructions and reference guidelines every request shares (about 6,000 tokens). */
export const GUIDELINES = policyText(110);

const ASKED = [4, 11, 19, 26, 33, 41, 48, 55];

export const TURNS = ASKED.map((i) => ({
  part: i,
  input: `What is the maximum working load of part ${partCode(i)}? Give the load in kg and the id of the chunk you took it from.`,
  expect: [chunk(i).id, String(rating(i))],
}));

/** The retrieved chunks for the part a question names. */
export function retrieveFor(input: string, session = 0): Chunk[] {
  const turn = TURNS.find((t) => input.includes(t.input));
  return retrieve(turn ? turn.part : 0, session);
}
