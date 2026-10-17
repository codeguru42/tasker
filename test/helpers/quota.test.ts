import { describe, expect, it } from "vitest";
import { quotaPauseLineExpected } from "./quota.js";

describe("quotaPauseLineExpected", () => {
  it("names the reset time as an ISO time", () => {
    expect(quotaPauseLineExpected("planning", 95, 1792206000)).toBe(
      "planning paused by a quota warning: the use of the quota window is 95%; it resets at 2026-10-17T03:00:00.000Z\n",
    );
  });

  it("says that the reset time is unknown when it has none", () => {
    expect(quotaPauseLineExpected("executing", 96)).toBe(
      "executing paused by a quota warning: the use of the quota window is 96%; the reset time is unknown\n",
    );
  });
});
