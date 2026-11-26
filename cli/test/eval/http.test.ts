import { describe, expect, it } from "vitest";
import { HttpClient, HttpError, parseRetryAfter } from "../../../eval/http.js";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const BODY_SECRET = "ZEBRA-QUARTZ prompt echo that must never reach an error";

const client = (res: { status: number; headers?: Record<string, string>; body?: unknown; raw?: string }) =>
  new HttpClient({
    provider: "openai",
    model: "m",
    baseUrl: "http://x",
    now: () => NOW,
    fetch: (async () =>
      new Response(res.raw ?? JSON.stringify(res.body ?? {}), { status: res.status, headers: res.headers })) as unknown as typeof fetch,
  });
const fail = async (c: HttpClient): Promise<HttpError> => {
  try {
    await c.send({ dialect: "openai.chat", body: { messages: [] } });
  } catch (e) {
    return e as HttpError;
  }
  throw new Error("expected the call to fail");
};

describe("HttpClient errors", () => {
  it("carry status, numeric Retry-After and the provider's type and code", async () => {
    const e = await fail(client({ status: 429, headers: { "retry-after": "7" }, body: { error: { type: "insufficient_quota", code: "insufficient_quota", message: BODY_SECRET } } }));
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(429);
    expect(e.retryAfter).toBe(7);
    expect(e.type).toBe("insufficient_quota");
    expect(e.code).toBe("insufficient_quota");
  });

  it("read Retry-After given as an HTTP-date, in seconds from now", async () => {
    const e = await fail(client({ status: 503, headers: { "retry-after": new Date(NOW + 12_000).toUTCString() } }));
    expect(e.status).toBe(503);
    expect(e.retryAfter).toBe(12);
    expect(parseRetryAfter(new Date(NOW - 5000).toUTCString(), NOW)).toBe(0);
    expect(parseRetryAfter("soon", NOW)).toBeUndefined();
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
  });

  it("have only the status when there is no header or no JSON body", async () => {
    const e = await fail(client({ status: 502, raw: "<html>bad gateway</html>" }));
    expect(e.status).toBe(502);
    expect(e.retryAfter).toBeUndefined();
    expect(e.type).toBeUndefined();
    expect(e.code).toBeUndefined();
  });

  it("take a numeric code and skip a type that is not a short identifier", async () => {
    const e = await fail(client({ status: 400, body: { error: { type: BODY_SECRET, code: 4291 } } }));
    expect(e.code).toBe("4291");
    expect(e.type).toBeUndefined();
  });

  it("never carry the message text or the body", async () => {
    const e = await fail(client({ status: 400, body: { error: { type: "invalid_request_error", message: BODY_SECRET } } }));
    expect(JSON.stringify({ ...e, message: e.message, stack: e.stack })).not.toContain("ZEBRA");
    expect(e.message).toBe("openai request failed: HTTP 400");
  });
});
