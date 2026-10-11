import { describe, expect, it } from "vitest";
import { STATES, TERMINAL_STATES, isTaskState } from "../../src/state/machine.js";

describe("task states", () => {
  it("declares the 28 states in order", () => {
    expect(STATES).toEqual([
      "provisioning",
      "workspace_ready",
      "planning",
      "awaiting_plan_review",
      "refining",
      "approved",
      "executing",
      "executed",
      "verifying",
      "awaiting_work_review",
      "reviewing",
      "reviewed",
      "accepted",
      "pushing",
      "pushed",
      "opening_pr",
      "in_peer_review",
      "merging",
      "landed",
      "finishing",
      "cleanup_failed",
      "finished",
      "updating_branch",
      "quota_blocked",
      "awaiting_quota_approval",
      "interrupted",
      "failed",
      "cancelled",
    ]);
  });

  it("does not declare awaiting_input", () => {
    expect(STATES).not.toContain("awaiting_input");
  });

  it("has finished and cancelled as the terminal states", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(["cancelled", "finished"]);
  });

  it("tells a known state from an unknown one", () => {
    expect(isTaskState("planning")).toBe(true);
    expect(isTaskState("awaiting_input")).toBe(false);
    expect(isTaskState("new")).toBe(false);
  });
});
