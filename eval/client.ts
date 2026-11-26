import type { Dialect } from "@kvsig/core";

export interface LlmRequest {
  dialect: Dialect;
  body: unknown;
  timeoutMs?: number;
}

export interface LlmResponse {
  body: unknown;
  /** The provider's own usage object, in its own field names (read it with usageFrom). */
  usage: unknown;
  finish: string;
}

export interface LlmClient {
  send(req: LlmRequest): Promise<LlmResponse>;
}
