import { describe, expect, it } from "vitest";
import { expectedShowLines, expectedStateCommands, wrongStateError } from "./state-commands.js";

describe("expectedStateCommands", () => {
  it("gives the primary command and all commands of a state with a primary", () => {
    expect(expectedStateCommands("workspace_ready")).toEqual({ primary: "plan", commands: ["plan", "abort"] });
  });

  it("gives no primary command for a state with two choices", () => {
    expect(expectedStateCommands("awaiting_plan_review")).toEqual({ commands: ["refine", "approve", "abort"] });
  });

  it("gives nothing for a terminal state", () => {
    expect(expectedStateCommands("finished")).toBeUndefined();
  });
});

describe("expectedShowLines", () => {
  const key = "codeguru42/tasker#5";

  it("gives the next and also lines for a state with a primary command", () => {
    expect(expectedShowLines("workspace_ready", key)).toBe(
      "next: tasker plan codeguru42/tasker#5\nalso: tasker abort codeguru42/tasker#5\n",
    );
  });

  it("gives one commands line for a state with no primary command", () => {
    expect(expectedShowLines("awaiting_plan_review", key)).toBe(
      "commands: tasker refine codeguru42/tasker#5, tasker approve codeguru42/tasker#5, tasker abort codeguru42/tasker#5\n",
    );
  });

  it("gives an empty string for a terminal state", () => {
    expect(expectedShowLines("finished", key)).toBe("");
  });
});

describe("wrongStateError", () => {
  const key = "codeguru42/tasker#5";

  it("gives the old text and the next sentence for a state with a primary command", () => {
    expect(wrongStateError("workspace_ready", key, "execute", "approved")).toBe(
      "the task of codeguru42/tasker#5 is in workspace_ready; tasker execute needs approved. next: tasker plan codeguru42/tasker#5 (also: tasker abort codeguru42/tasker#5)",
    );
  });

  it("gives the commands sentence for a state with no primary command", () => {
    expect(wrongStateError("awaiting_plan_review", key, "execute", "approved")).toBe(
      "the task of codeguru42/tasker#5 is in awaiting_plan_review; tasker execute needs approved. commands: tasker refine codeguru42/tasker#5, tasker approve codeguru42/tasker#5, tasker abort codeguru42/tasker#5",
    );
  });

  it("gives only the old text for a terminal state", () => {
    expect(wrongStateError("finished", key, "finish", "landed or cleanup_failed")).toBe(
      "the task of codeguru42/tasker#5 is in finished; tasker finish needs landed or cleanup_failed",
    );
  });
});
