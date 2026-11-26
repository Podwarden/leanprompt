import { policyText } from "../common.js";

export const SYSTEM = `You write release notes for a home-goods web shop. Follow the requested format exactly.\n${policyText(12)}`;

export const ITEMS = 40;
export const MAX_TOKENS = 2_500;

const pad = (n: number): string => String(n).padStart(2, "0");

/** True for the requests that ask for a long answer (about 2,000 tokens). */
export const isLong = (input: string): boolean => input.includes("numbered items");

/** Eight requests per session, alternating a long answer (forty numbered items) with a one-line answer. */
export const TURNS = Array.from({ length: 8 }, (_, k) =>
  k % 2 === 0
    ? {
        input:
          `Write the release notes for version 2.${k + 1}. Give exactly ${ITEMS} numbered items, ITEM-01 to ITEM-${ITEMS}, ` +
          `each on its own line with two sentences, then a last line that says END.`,
        expect: ["ITEM-01", `ITEM-${pad(ITEMS / 2)}`, `ITEM-${ITEMS}`, "END"],
      }
    : {
        input: `In at most 15 words, what is the main change in version 2.${k + 1}? Start your reply with "2.${k + 1}:".`,
        expect: [`2.${k + 1}`],
      },
);
