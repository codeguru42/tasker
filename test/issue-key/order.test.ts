import { describe, expect, it } from "vitest";
import { compareIssueKeys } from "../../src/issue-key/order.js";

const order = (keys: string[]) => [...keys].sort(compareIssueKeys);

describe("compareIssueKeys", () => {
  it("puts #9 before #10", () => {
    expect(order(["codeguru42/tasker#10", "codeguru42/tasker#9"])).toEqual([
      "codeguru42/tasker#9",
      "codeguru42/tasker#10",
    ]);
  });

  it("lets the text before the number decide between two repos", () => {
    expect(order(["codeguru42/tasker#2", "codeguru42/other#10"])).toEqual([
      "codeguru42/other#10",
      "codeguru42/tasker#2",
    ]);
  });

  it("orders Jira keys by their number", () => {
    expect(order(["PROJ-10", "PROJ-9", "ABC-100"])).toEqual(["ABC-100", "PROJ-9", "PROJ-10"]);
  });

  it("puts a key with no trailing number before the same text with a number", () => {
    expect(order(["abc1", "abc"])).toEqual(["abc", "abc1"]);
  });

  it("falls back to plain text order for equal numbers", () => {
    expect(order(["a#7", "a#007"])).toEqual(["a#007", "a#7"]);
    expect(compareIssueKeys("a#7", "a#7")).toBe(0);
  });
});
