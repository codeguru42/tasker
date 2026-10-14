import { describe, expect, it } from "vitest";
import { createClaudeCodeProvider } from "../../../src/assistant/claude-code/provider.js";
import type { AssistantEvent, RunOutcome } from "../../../src/assistant/provider.js";
import { overageStopOf, quotaStopOf } from "../../../src/assistant/claude-code/quota.js";
import {
  claudeOverageEvent,
  claudeRateLimitEvent,
  claudeSampleEvents,
  claudeSampleWithResult,
  TEST_SESSION_ID,
} from "../../helpers.js";

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

// quota-stop.jsonl: the lines of plain.jsonl and the capture of rate-limit-warning.jsonl. The rate_limit_event
// differs from the capture in status, rateLimitType, utilization, resetsAt and unifiedWindows.five_hour. The
// result differs from plain.jsonl in subtype, stop_reason, is_error, terminal_reason and api_error_status.
describe("quotaStopOf", () => {
  const rejected = (resetsAt: unknown) =>
    claudeRateLimitEvent((info) => {
      info["status"] = "rejected";
      info["resetsAt"] = resetsAt;
    });

  it("gives the reset time of the rejected event for exit code 1", () => {
    expect(quotaStopOf(claudeSampleEvents("quota-stop"), 1)).toEqual({ resetsAt: 1791906000 });
  });

  it("gives the same for a null exit code", () => {
    expect(quotaStopOf(claudeSampleEvents("quota-stop"), null)).toEqual({ resetsAt: 1791906000 });
  });

  it("gives nothing for exit code 0", () => {
    expect(quotaStopOf(claudeSampleEvents("quota-stop"), 0)).toBeUndefined();
  });

  it("gives nothing for the plain sample with exit code 1", () => {
    expect(quotaStopOf(claudeSampleEvents("plain"), 1)).toBeUndefined();
  });

  it.each<[string, (result: AssistantEvent) => void]>([
    ["api_error_status is 500", (r) => void (r["api_error_status"] = 500)],
    ["terminal_reason is completed", (r) => void (r["terminal_reason"] = "completed")],
  ])("gives nothing when %s", (_name, edit) => {
    expect(quotaStopOf(claudeSampleWithResult("quota-stop", edit), 1)).toBeUndefined();
  });

  it("still gives a stop when is_error is false, and the sample keeps its decoys", () => {
    const events = claudeSampleWithResult("quota-stop", (r) => void (r["is_error"] = false));

    expect(events.at(-1)).toMatchObject({ subtype: "success", stop_reason: "stop_sequence" });
    expect(quotaStopOf(events, 1)).toEqual({ resetsAt: 1791906000 });
  });

  it("gives the flat resetsAt when the unified entry differs", () => {
    const events = claudeSampleEvents("quota-stop");
    const info = events[2]!["rate_limit_info"] as Record<string, unknown>;
    info["resetsAt"] = 42;

    expect(quotaStopOf(events, 1)).toEqual({ resetsAt: 42 });
  });

  it("gives the last rejected event", () => {
    const events = claudeSampleEvents("quota-stop");
    events.splice(2, 1, rejected(1), rejected(2));

    expect(quotaStopOf(events, 1)).toEqual({ resetsAt: 2 });
  });

  it("does not count a later allowed event", () => {
    const events = claudeSampleEvents("quota-stop");
    events.splice(3, 0, claudeRateLimitEvent((info) => void (info["status"] = "allowed")));

    expect(quotaStopOf(events, 1)).toEqual({ resetsAt: 1791906000 });
  });

  it("gives no resetsAt key when no event is rejected", () => {
    const events = claudeSampleEvents("quota-stop");
    events.splice(2, 1);

    expect(quotaStopOf(events, 1)).toEqual({});
    expect(quotaStopOf(events, 1)).not.toHaveProperty("resetsAt");
  });

  it("gives no resetsAt key when the rejected resetsAt is a string", () => {
    const events = claudeSampleEvents("quota-stop");
    events.splice(2, 1, rejected("soon"));

    expect(quotaStopOf(events, 1)).not.toHaveProperty("resetsAt");
    expect(quotaStopOf(events, 1)).toEqual({});
  });

  it("gives nothing when the 429 result is not the last event", () => {
    const events = claudeSampleEvents("quota-stop");
    events.push(claudeRateLimitEvent());

    expect(quotaStopOf(events, 1)).toBeUndefined();
  });
});

describe("overageStopOf", () => {
  const windows = (info: Info) => info["unifiedWindows"] as Info;

  it.each<[string, AssistantEvent]>([
    ["isUsingOverage is true", claudeOverageEvent()],
    [
      "status is rejected and overageStatus is allowed",
      claudeRateLimitEvent((info) => {
        info["status"] = "rejected";
        info["overageStatus"] = "allowed";
      }),
    ],
    [
      "status is rejected and overageStatus is allowed_warning",
      claudeRateLimitEvent((info) => {
        info["status"] = "rejected";
        info["overageStatus"] = "allowed_warning";
      }),
    ],
  ])("gives a stop when %s", (_name, event) => {
    expect(overageStopOf(event, {})).toEqual({ resetsAt: 1792206000 });
  });

  it.each<[string, (info: Info) => void]>([
    ["the event is the capture", () => {}],
    [
      "only utilization is 1",
      (info) => {
        info["utilization"] = 1;
      },
    ],
    [
      "status is rejected and overageStatus is rejected",
      (info) => {
        info["status"] = "rejected";
      },
    ],
    [
      "status is allowed and overageStatus is allowed",
      (info) => {
        info["status"] = "allowed";
        info["overageStatus"] = "allowed";
      },
    ],
  ])("gives nothing when %s", (_name, edit) => {
    expect(overageStopOf(claudeRateLimitEvent(edit), {})).toBeUndefined();
  });

  it("takes the unified resetsAt over a different flat one", () => {
    const event = claudeOverageEvent((info) => {
      info["resetsAt"] = 7;
    });

    expect(overageStopOf(event, {})).toEqual({ resetsAt: 1792206000 });
  });

  it.each<[string, (info: Info) => void]>([
    [
      "unifiedWindows.seven_day.resetsAt is deleted",
      (info) => {
        delete (windows(info)["seven_day"] as Info)["resetsAt"];
      },
    ],
    [
      "unifiedWindows.seven_day is a number",
      (info) => {
        windows(info)["seven_day"] = 3;
      },
    ],
  ])("takes the flat resetsAt when %s", (_name, edit) => {
    const event = claudeOverageEvent((info) => {
      info["resetsAt"] = 7;
      edit(info);
    });

    expect(overageStopOf(event, {})).toEqual({ resetsAt: 7 });
  });

  it("takes the window with the highest use when rateLimitType is overage", () => {
    const event = claudeOverageEvent((info) => {
      info["rateLimitType"] = "overage";
      info["resetsAt"] = 7;
      (windows(info)["five_hour"] as Info)["utilization"] = 0.95;
    });

    expect(overageStopOf(event, {})).toEqual({ resetsAt: 1791906000 });
  });

  it("skips a window whose use is a string", () => {
    const event = claudeOverageEvent((info) => {
      info["rateLimitType"] = "overage";
      (windows(info)["five_hour"] as Info)["utilization"] = "0.95";
    });

    expect(overageStopOf(event, {})).toEqual({ resetsAt: 1792206000 });
  });

  it("gives no resetsAt key when rateLimitType is overage and unifiedWindows is deleted", () => {
    const event = claudeOverageEvent((info) => {
      info["rateLimitType"] = "overage";
      delete info["unifiedWindows"];
    });

    const stop = overageStopOf(event, {});

    expect(stop).toEqual({});
    expect(stop).not.toHaveProperty("resetsAt");
  });

  it("takes the window with the highest use when rateLimitType is deleted", () => {
    const event = claudeOverageEvent((info) => {
      delete info["rateLimitType"];
      (windows(info)["five_hour"] as Info)["utilization"] = 0.95;
    });

    expect(overageStopOf(event, {})).toEqual({ resetsAt: 1791906000 });
  });

  it("gives nothing when the window is the approved one", () => {
    expect(overageStopOf(claudeOverageEvent(), { approvedResetsAt: 1792206000 })).toBeUndefined();
  });

  it("gives a stop when the approved window is another one", () => {
    expect(overageStopOf(claudeOverageEvent(), { approvedResetsAt: 1 })).toEqual({ resetsAt: 1792206000 });
  });

  it("gives a stop when the event has no reset time and a window is approved", () => {
    const event = claudeOverageEvent((info) => {
      info["rateLimitType"] = "overage";
      delete info["unifiedWindows"];
    });

    expect(overageStopOf(event, { approvedResetsAt: 1792206000 })).toEqual({});
  });

  it.each<[string, AssistantEvent]>([
    ["a result event", { type: "result" }],
    ["rate_limit_info null", { type: "rate_limit_event", rate_limit_info: null }],
    ["rate_limit_info a string", { type: "rate_limit_event", rate_limit_info: "x" }],
    ["rate_limit_info a list", { type: "rate_limit_event", rate_limit_info: [] }],
    ["no rate_limit_info", { type: "rate_limit_event" }],
  ])("gives nothing and does not throw for %s", (_name, event) => {
    expect(overageStopOf(event, {})).toBeUndefined();
  });
});
