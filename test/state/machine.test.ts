import { describe, expect, it } from "vitest";
import {
  STATES,
  TERMINAL_STATES,
  canTransition,
  isTaskState,
  type TaskState,
} from "../../src/state/machine.js";

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

const NON_TERMINAL = STATES.filter((s) => !TERMINAL_STATES.has(s));

describe("rule edges", () => {
  it.each(STATES)("refuses the self-transition of %s", (state) => {
    expect(canTransition(state, state)).toBe(false);
  });

  it.each(NON_TERMINAL)("allows %s -> cancelled", (state) => {
    expect(canTransition(state, "cancelled")).toBe(true);
  });

  it.each(NON_TERMINAL.filter((s) => s !== "failed"))(
    "allows %s -> failed",
    (state) => {
      expect(canTransition(state, "failed")).toBe(true);
    },
  );

  it.each(["finished", "cancelled"] as TaskState[])(
    "allows no edge out of %s",
    (terminal) => {
      for (const to of STATES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    },
  );

  it("refuses failed -> failed", () => {
    expect(canTransition("failed", "failed")).toBe(false);
  });
});
