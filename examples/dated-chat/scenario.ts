import { containsAll } from "../common.js";
import type { Scenario } from "../types.js";
import { TURNS } from "./data.js";

export const SESSIONS = 4;

/** Four support sessions of eight questions each. */
export const scenario: Scenario = { sessions: SESSIONS, turns: TURNS.map((t) => ({ input: t.input })) };

/** The words each answer must hold, in call order (session after session). */
export const expected: string[][] = Array.from({ length: SESSIONS }, () => TURNS.map((t) => [t.expect])).flat();

/** Expected word per input, for tests and replays that answer by question. */
export const answerFor = (input: string): string => TURNS.find((t) => input.includes(t.input))?.expect ?? "";

export const check = containsAll(expected);
