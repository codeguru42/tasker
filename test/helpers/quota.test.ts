import { describe, expect, it } from "vitest";
import { approvedCreditsLineExpected, quotaPauseLineExpected } from "./quota.js";

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

describe("approvedCreditsLineExpected", () => {
  it("names the approved window by its ISO reset time", () => {
    expect(approvedCreditsLineExpected("a/b#1", 1792206000)).toBe(
      "approved credits for a/b#1: the quota window that resets at 2026-10-17T03:00:00.000Z\n",
    );
  });

  it("says that the pause named no window when it has none", () => {
    expect(approvedCreditsLineExpected("a/b#1")).toBe(
      "approved credits for a/b#1: the pause named no window, so the next warning pauses again\n",
    );
  });
});
