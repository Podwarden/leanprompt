import { containsAll } from "../common.js";
import type { Scenario } from "../types.js";
import { TURNS } from "./data.js";

export const SESSIONS = 4;

/** Four support sessions of eight questions each; every question comes with three retrieved chunks. */
export const scenario: Scenario = { sessions: SESSIONS, turns: TURNS.map((t) => ({ input: t.input })) };

/** The words each answer must hold, in call order: the id of the right chunk and the figure it states. */
export const expected: string[][] = Array.from({ length: SESSIONS }, () => TURNS.map((t) => t.expect)).flat();

/** What a good answer to `input` says, for tests and replays that answer by question. */
export const answerFor = (input: string): string => {
  const t = TURNS.find((x) => input.includes(x.input));
  return t ? `${t.expect[1]} kg, from ${t.expect[0]}` : "";
};

export const check = containsAll(expected);
