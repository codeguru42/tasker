import { describe, expect, it } from "vitest";
import { piQuotaStream } from "./pi-quota-streams.js";

describe("piQuotaStream", () => {
  it.each([
    "quotaDelay",
    "quotaDate",
    "quotaNoRetryAfter",
    "quotaCutComplete",
    "quotaCutValue",
    "quotaSpaceWhole",
    "quotaSpaceNoBody",
    "error429Colon",
    "error429Space",
    "retryWorks",
    "retryFails",
  ])("returns a record with the session, stream, and transcript fields for %s", (name) => {
    const record = piQuotaStream(name);
    expect(record).toMatchObject({
      sessionFile: expect.any(String),
      stdout: expect.any(Array),
      session: expect.any(Array),
    });
    expect(record.session[0]).toMatchObject({ type: "session" });
  });

  it("returns an independent named record with the expected fields", () => {
    const record = piQuotaStream("quotaDelay");
    expect(record).toMatchObject({
      sessionFile: expect.any(String),
      stdout: expect.any(Array),
      session: expect.any(Array),
    });
    const assistant = record.stdout.find(
      (event) => event.type === "message_end" && (event.message as { role?: string }).role === "assistant",
    );
    expect(assistant).toMatchObject({ message: { role: "assistant", stopReason: "error" } });
    record.stdout.pop();
    expect(piQuotaStream("quotaDelay").stdout.length).toBeGreaterThan(record.stdout.length);
  });

  it("rejects an unknown record name", () => {
    expect(() => piQuotaStream("missing")).toThrow("unknown pi quota stream: missing");
  });
});
