/** The simulator's token count: ceil(chars / 4). Deterministic; not a real tokenizer. */
export const tokensOf = (chars: number): number => Math.ceil(chars / 4);
