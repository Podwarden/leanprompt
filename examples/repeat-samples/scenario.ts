import { containsAll } from "../common.js";
import type { Scenario } from "../types.js";
import { TURNS } from "./data.js";

export const SESSIONS = 4;

/** Four sessions of eight questions. Each question is sampled several times and the app returns the majority answer. */
export const scenario: Scenario = { sessions: SESSIONS, turns: TURNS.map((t) => ({ input: t.input })) };

export const expected: string[][] = Array.from({ length: SESSIONS }, () => TURNS.map((t) => [t.expect])).flat();

export const answerFor = (input: string): string => TURNS.find((t) => input.includes(t.input))?.expect ?? "";

export const check = containsAll(expected);
