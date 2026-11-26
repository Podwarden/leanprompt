import { containsAll } from "../common.js";
import type { Scenario } from "../types.js";
import { CANNED_SUMMARY, SUMMARISE, TURNS } from "./data.js";

export const SESSIONS = 4;

/** Four sessions of eight turns. The conversation is compacted after turn four; the last four turns ask for what the first four stated. */
export const scenario: Scenario = { sessions: SESSIONS, turns: TURNS.map((t) => ({ input: t.input })) };

export const expected: string[][] = Array.from({ length: SESSIONS }, () => TURNS.map((t) => [t.expect])).flat();

/** What a good answer to `input` says; the summarising request gets a summary that holds all four facts. */
export const answerFor = (input: string): string =>
  input.includes(SUMMARISE) ? CANNED_SUMMARY : (TURNS.find((t) => input.includes(t.input))?.expect ?? "");

export const check = containsAll(expected);
