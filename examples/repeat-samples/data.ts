// A synthetic field survey (invented names and readings) and eight lookup questions about it.

import { policyText } from "../common.js";

const OBSERVERS = ["Okafor", "Lindqvist", "Marchetti", "Tanaka", "Abernathy", "Vasquez", "Kowalczyk", "Haddad"];
const SITES = ["north ridge", "mill pond", "quarry edge", "old orchard", "salt flat", "pine hollow", "river bend", "stone gate"];
const COUNT = 110;

export const stationId = (i: number): string => `S-${100 + i}`;
export const observer = (i: number): string => OBSERVERS[(i * 5 + (i >> 3)) % 8];

export const SYSTEM = [
  "You answer questions about a field survey from the log below. Reply with the answer only.",
  ...Array.from({ length: COUNT }, (_, i) => `Station ${stationId(i)} at the ${SITES[(i * 3) % 8]}: logged by ${observer(i)}, reading ${(1 + ((i * 13) % 90) / 10).toFixed(1)}, checked twice.`),
  policyText(30),
].join("\n");

/** How many samples each question collects, and the temperature they are drawn at. */
export const SAMPLES = 4;
export const TEMPERATURE = 0.8;

const ASKED = [6, 19, 27, 38, 52, 64, 81, 97];
export const TURNS = ASKED.map((i) => ({
  input: `Which observer logged station ${stationId(i)}? Reply with the surname only.`,
  expect: observer(i),
}));
