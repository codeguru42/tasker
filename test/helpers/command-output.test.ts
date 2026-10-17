import { describe, expect, it } from "vitest";
import {
  executedLine,
  plannedLine,
  refinedLine,
  resumedLine,
  reviewedLinePrefix,
  verifiedLine,
} from "./command-output.js";

describe("command output lines", () => {
  it("builds the planned line", () => {
    expect(plannedLine("a/b#1", 1)).toBe("planned a/b#1 as revision v1");
  });

  it("builds the refined line", () => {
    expect(refinedLine("a/b#1", 2)).toBe("refined a/b#1 as revision v2");
  });

  it("builds the executed line", () => {
    expect(executedLine("a/b#1", 3)).toBe("executed a/b#1 at revision v3");
  });

  it("builds the verified line", () => {
    expect(verifiedLine("a/b#1", 4)).toBe("verified a/b#1: run 4");
  });

  it("builds the prefix of the reviewed line", () => {
    expect(reviewedLinePrefix("a/b#1", 5)).toBe("reviewed a/b#1: review 5");
  });

  it("builds the resumed line with a newline", () => {
    expect(resumedLine("a/b#1", "planning", "workspace_ready")).toBe(
      "resumed a/b#1: paused in planning, back in workspace_ready\n",
    );
  });
});
