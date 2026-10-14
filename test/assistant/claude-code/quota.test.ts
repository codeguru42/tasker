import { describe, expect, it } from "vitest";
import { createClaudeCodeProvider } from "../../../src/assistant/claude-code/provider.js";
import type { AssistantEvent, RunOutcome } from "../../../src/assistant/provider.js";
import { claudeRateLimitEvent, claudeSampleEvents, TEST_SESSION_ID } from "../../helpers.js";

function outcomeWith(events: AssistantEvent[]): RunOutcome {
  return { kind: "success", sessionId: TEST_SESSION_ID, events, permissionDenials: [], usage: "unavailable" };
}

function warningOf(events: AssistantEvent[], threshold: number) {
  return createClaudeCodeProvider().detectQuotaApprovalWarning(outcomeWith(events), threshold);
}

type Info = Record<string, unknown>;

describe("detectQuotaApprovalWarning", () => {
  const capture = { utilization: 0.8, resetsAt: 1792206000 };

  it("gives the window of the capture when the use reaches the threshold", () => {
    expect(warningOf([claudeRateLimitEvent()], 0.75)).toEqual(capture);
  });

  it("gives the window when the use equals the threshold", () => {
    expect(warningOf([claudeRateLimitEvent()], 0.8)).toEqual(capture);
  });

  it("gives nothing when the use is under the threshold", () => {
    expect(warningOf([claudeRateLimitEvent()], 0.9)).toBeUndefined();
  });

  it.each<[string, (info: Info) => void, unknown]>([
    [
      "the flat utilization is 0.5 and the unified seven_day is 0.8",
      (info) => {
        info["utilization"] = 0.5;
      },
      capture,
    ],
    [
      "utilization, surpassedThreshold and overageEnabled are deleted",
      (info) => {
        delete info["utilization"];
        delete info["surpassedThreshold"];
        delete info["overageEnabled"];
      },
      capture,
    ],
    [
      "unifiedWindows is deleted",
      (info) => {
        delete info["unifiedWindows"];
      },
      capture,
    ],
    [
      "unifiedWindows is null",
      (info) => {
        info["unifiedWindows"] = null;
      },
      capture,
    ],
    [
      "unifiedWindows is a list",
      (info) => {
        info["unifiedWindows"] = [];
      },
      capture,
    ],
    [
      "unifiedWindows is empty",
      (info) => {
        info["unifiedWindows"] = {};
      },
      capture,
    ],
    [
      "unifiedWindows.seven_day is a number",
      (info) => {
        (info["unifiedWindows"] as Info)["seven_day"] = 5;
      },
      capture,
    ],
    [
      "unifiedWindows.seven_day is a string",
      (info) => {
        (info["unifiedWindows"] as Info)["seven_day"] = "x";
      },
      capture,
    ],
    [
      "rateLimitType is deleted",
      (info) => {
        delete info["rateLimitType"];
      },
      capture,
    ],
    [
      "utilization is a string and unifiedWindows is deleted",
      (info) => {
        info["utilization"] = "0.8";
        delete info["unifiedWindows"];
      },
      undefined,
    ],
    [
      "the resetsAt of the unified entry is a string",
      (info) => {
        ((info["unifiedWindows"] as Info)["seven_day"] as Info)["resetsAt"] = "soon";
      },
      { utilization: 0.8 },
    ],
    [
      "rateLimitType is overage, utilization is 0.99 and isUsingOverage is false",
      (info) => {
        info["rateLimitType"] = "overage";
        info["utilization"] = 0.99;
      },
      undefined,
    ],
    [
      "rateLimitType is overage, utilization is 0.95 and isUsingOverage is true",
      (info) => {
        info["rateLimitType"] = "overage";
        info["utilization"] = 0.95;
        info["isUsingOverage"] = true;
      },
      { utilization: 0.95, resetsAt: 1792206000 },
    ],
  ])("when %s", (_name, edit, expected) => {
    const warning = warningOf([claudeRateLimitEvent(edit)], 0.75);

    expect(warning).toEqual(expected);
    if (expected !== undefined && !("resetsAt" in (expected as object))) {
      expect(warning).not.toHaveProperty("resetsAt");
    }
  });

  it("keeps the last window, not the highest", () => {
    const events = [
      claudeRateLimitEvent((info) => {
        info["utilization"] = 0.95;
        ((info["unifiedWindows"] as Info)["seven_day"] as Info)["utilization"] = 0.95;
        info["resetsAt"] = 1;
        ((info["unifiedWindows"] as Info)["seven_day"] as Info)["resetsAt"] = 1;
      }),
      claudeRateLimitEvent((info) => {
        ((info["unifiedWindows"] as Info)["seven_day"] as Info)["utilization"] = 0.5;
        ((info["unifiedWindows"] as Info)["seven_day"] as Info)["resetsAt"] = 2;
      }),
    ];

    expect(warningOf(events, 0.9)).toBeUndefined();
  });

  it("skips an event whose status is allowed", () => {
    const allowed = claudeRateLimitEvent((info) => {
      info["status"] = "allowed";
      info["utilization"] = 0.99;
      ((info["unifiedWindows"] as Info)["seven_day"] as Info)["utilization"] = 0.99;
    });

    expect(warningOf([claudeRateLimitEvent(), allowed], 0.75)).toEqual(capture);
  });

  it("does not throw on bad events and keeps the window of the capture", () => {
    const bad: AssistantEvent[] = [
      { type: "rate_limit_event", rate_limit_info: null },
      { type: "rate_limit_event", rate_limit_info: "x" },
      { type: "rate_limit_event", rate_limit_info: [] },
      { type: "rate_limit_event" },
      { type: "result" },
    ];

    expect(warningOf([...bad, claudeRateLimitEvent(), ...bad], 0.75)).toEqual(capture);
  });

  it("reads the warning of the plain sample", () => {
    expect(warningOf(claudeSampleEvents("plain"), 0.9)).toEqual({ utilization: 0.93, resetsAt: 1792206000 });
  });
});

describe("shouldSuppressQuotaApprovalPause", () => {
  const suppress = (warning: { utilization: number; resetsAt?: number }, approved: number | undefined) =>
    createClaudeCodeProvider().shouldSuppressQuotaApprovalPause(warning, approved);

  it("is true when the reset times are equal", () => {
    expect(suppress({ utilization: 0.9, resetsAt: 5 }, 5)).toBe(true);
  });

  it("is false when the reset times differ", () => {
    expect(suppress({ utilization: 0.9, resetsAt: 5 }, 6)).toBe(false);
  });

  it("is false when no window is approved", () => {
    expect(suppress({ utilization: 0.9, resetsAt: 5 }, undefined)).toBe(false);
  });

  it("is false when the warning has no reset time", () => {
    expect(suppress({ utilization: 0.9 }, 5)).toBe(false);
  });
});
