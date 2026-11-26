import { containsAll } from "../common.js";
import type { Scenario } from "../types.js";
import { TURNS } from "./data.js";

export const SESSIONS = 4;

/** Four sessions of eight requests, long answers alternating with short ones. Each request stands alone. */
export const scenario: Scenario = { sessions: SESSIONS, turns: TURNS.map((t) => ({ input: t.input })) };

export const expected: string[][] = Array.from({ length: SESSIONS }, () => TURNS.map((t) => t.expect)).flat();

/** The words a good answer to `input` holds. */
export const answerFor = (input: string): string => TURNS.find((t) => t.input === input)?.expect.join(" ") ?? "";

export const check = containsAll(expected);
