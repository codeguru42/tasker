import { describe, expect, it } from "vitest";
import { quotaStopOf as fromQuotaStopOf } from "../../../src/assistant/pi/quota.js";

function callQuotaStop(message: unknown): { resetsAt?: number } | undefined {
  return fromQuotaStopOf(message);
}

const colon = (body: string, stopReason = "error") => ({
  role: "assistant",
  stopReason,
  errorMessage: `402: ${body}`,
});
const space = (body: string, stopReason = "error") => ({
  role: "assistant",
  stopReason,
  errorMessage: `402 ${body}`,
});
const json = (value: unknown) => JSON.stringify(value);
const retry = (value: unknown) => ({ metadata: { headers: { "Retry-After": value } } });
const retryError = (value: unknown) => ({ error: retry(value) });
const date = "Wed, 04 Nov 2026 08:00:00 GMT";

describe("quotaStopOf", () => {
  it("returns undefined for no quota stop", () => {
    expect(callQuotaStop({ role: "assistant", stopReason: "stop", errorMessage: "done" })).toBeUndefined();
  });

  it("uses a delay in seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = callQuotaStop(colon(json(retry("3600"))));
    const after = Math.floor(Date.now() / 1000);
    expect(result?.resetsAt).toBeGreaterThanOrEqual(before + 3600);
    expect(result?.resetsAt).toBeLessThanOrEqual(after + 3600);
  });

  it.each([
    ["date in another form", colon(json(retry("Wed, 4 Nov 2026 08:00:00 GMT")))],
    ["nonexistent day", colon(json(retry("Tue, 31 Nov 2026 08:00:00 GMT")))],
    ["different values", colon('{"metadata":{"headers":{"Retry-After":"60","retry-after":"61"}}}')],
    ["numeric value", colon(json(retry(60)))],
    ["JSON string body", colon(json("body"))],
    ["JSON number body", colon("42")],
    ["JSON array body", colon("[]")],
    ["missing metadata", colon('{"headers":{"Retry-After":"60"}}')],
    ["string metadata", colon('{"metadata":"bad"}')],
    ["array metadata", colon('{"metadata":[]}')],
    ["string headers", colon('{"metadata":{"headers":"bad"}}')],
    ["array headers", colon('{"metadata":{"headers":[]}}')],
    ["unparseable body without marker", colon("not json")],
    ["missing retry-after in cut body", colon('{"code":402}... [truncated 10 chars]')],
    ["two different values in cut body", colon('{"Retry-After":"60","retry-after":"61" ... [truncated 10 chars]')],
    [
      "complete value followed by cut string value in colon form",
      colon('{"Retry-After":"60","retry-after":"6... [truncated 10 chars]'),
    ],
    [
      "complete value followed by non-string value in colon form",
      colon('{"Retry-After":"60","retry-after":61 ... [truncated 10 chars]'),
    ],
    [
      "complete value followed by cut string value in space form",
      space('{"error":{"metadata":{"headers":{"Retry-After":"60","retry-after":"6... [truncated 10 chars]'),
    ],
    ["cut retry-after value", colon('{"Retry-After":"6... [truncated 10 chars]')],
    [
      "space form metadata without headers",
      space('{"metadata":{},"error":{"metadata":{"headers":{"Retry-After":"60"}}}}'),
    ],
    ["missing error", space('{"metadata":{}}')],
    ["string error", space('{"error":"bad"}')],
    ["array error", space('{"error":[]}')],
    ["402 prose", space("Insufficient credits")],
    ["402 without body", space("status code (no body)")],
    ["space-form LF body", space('{"error":{"metadata":{"headers":{"Retry-After":"60"}}}\nsecond')],
    [
      "labeled OpenAI error",
      { role: "assistant", stopReason: "error", errorMessage: "OpenAI API error (402): {}" },
      null,
    ],
    ["429 colon prefix", { role: "assistant", stopReason: "error", errorMessage: "429: {}" }, null],
    ["429 space prefix", { role: "assistant", stopReason: "error", errorMessage: "429 {}" }, null],
    ["colon prefix with stop reason stop", colon(json(retry("60")), "stop"), null],
    ["space prefix with stop reason stop", space(json(retryError("60")), "stop"), null],
  ])("handles %s", (_name, message, expected: { resetsAt?: number } | null = {}) => {
    if (expected === null) expect(callQuotaStop(message)).toBeUndefined();
    else expect(callQuotaStop(message)).toEqual(expected);
  });

  it("returns a reset time for an HTTP date", () => {
    expect(callQuotaStop(colon(json(retry(date))))).toEqual({ resetsAt: 1793779200 });
  });

  it("accepts delay 0", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = callQuotaStop(colon(json(retry("0"))));
    const after = Math.floor(Date.now() / 1000);
    expect(result).toMatchObject({ resetsAt: expect.any(Number) });
    expect(result?.resetsAt).toBeGreaterThanOrEqual(before);
    expect(result?.resetsAt).toBeLessThanOrEqual(after);
  });

  it.each([
    ["value with spaces", colon(json(retry(" \t3600\t "))), 3600],
    ["seconds 60", colon(json(retry("60"))), 60],
    ["JSON followed by LF", colon(`${json(retry("60"))}\nsecond line`), 60],
    ["two equal values in cut body", colon('{"Retry-After":"60","retry-after":"60" ... [truncated 10 chars]'), 60],
    ["space form error metadata delay", space(json(retryError("3600"))), 3600],
    ["space form top-level metadata", space(json(retry("60"))), 60],
    [
      "space-form cut body",
      space('{"error":{"metadata":{"headers":{"Retry-After":"60"}} ... [truncated 10 chars]'),
      60,
    ],
  ])("accepts %s", (_name, message, delay: number) => {
    const before = Math.floor(Date.now() / 1000);
    const result = callQuotaStop(message);
    const after = Math.floor(Date.now() / 1000);
    expect(result).toMatchObject({ resetsAt: expect.any(Number) });
    expect(result?.resetsAt).toBeGreaterThanOrEqual(before + delay);
    expect(result?.resetsAt).toBeLessThanOrEqual(after + delay);
  });

  it("accepts a space-form error metadata date", () => {
    expect(callQuotaStop(space(json(retryError(date))))).toEqual({ resetsAt: 1793779200 });
  });

  it.each([
    ["case-different keys with equal values", '{"metadata":{"headers":{"Retry-After":"60","retry-after":"60"}}}'],
    ["equal values after trim", '{"metadata":{"headers":{"Retry-After":"60","retry-after":" 60 "}}}'],
  ])("accepts %s", (_name, body) => {
    const before = Math.floor(Date.now() / 1000);
    const result = callQuotaStop(colon(body));
    const after = Math.floor(Date.now() / 1000);
    expect(result).toMatchObject({ resetsAt: expect.any(Number) });
    expect(result?.resetsAt).toBeGreaterThanOrEqual(before + 60);
    expect(result?.resetsAt).toBeLessThanOrEqual(after + 60);
  });

  it("keeps a past reset time", () => {
    expect(callQuotaStop(colon(json(retry("Wed, 04 Nov 2020 08:00:00 GMT"))))).toEqual({ resetsAt: 1604476800 });
  });

  it("uses a complete value before a truncation marker", () => {
    const message = colon(
      '{"code":402,"metadata":{"headers":{"Retry-After":"3600"}},"message":"' +
        "x".repeat(4000) +
        "... [truncated 1071 chars]",
    );
    const before = Math.floor(Date.now() / 1000);
    const result = callQuotaStop(message);
    const after = Math.floor(Date.now() / 1000);
    expect(result).toMatchObject({ resetsAt: expect.any(Number) });
    expect(result?.resetsAt).toBeGreaterThanOrEqual(before + 3600);
    expect(result?.resetsAt).toBeLessThanOrEqual(after + 3600);
  });

  it("returns undefined for a non-402 result", () => {
    expect(callQuotaStop({ role: "assistant", stopReason: "error", errorMessage: "429: {}" })).toBeUndefined();
  });
});
