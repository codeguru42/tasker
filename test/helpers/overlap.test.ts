import { describe, expect, it } from "vitest";
import { overlapWarningText } from "./overlap.js";

describe("overlapWarningText", () => {
  it("gives the fixed lines, one entry with one file and the last line", () => {
    expect(
      overlapWarningText([{ issueKey: "a/b#6", state: "awaiting_plan_review", files: ["src/a.ts"] }], ["last."]),
    ).toBe(
      "WARNING: this plan changes files that other tasks in flight also change.\n" +
        "The task that lands second can get merge conflicts and redo its work.\n" +
        "  a/b#6 (awaiting_plan_review):\n" +
        "    src/a.ts\n" +
        "last.\n",
    );
  });

  it("keeps the order of the entries and of the files", () => {
    expect(
      overlapWarningText(
        [
          { issueKey: "a/b#6", state: "workspace_ready", files: ["src/b.ts", "src/a.ts"] },
          { issueKey: "a/b#10", state: "awaiting_plan_review", files: ["src/c.ts"] },
        ],
        ["last."],
      ),
    ).toBe(
      "WARNING: this plan changes files that other tasks in flight also change.\n" +
        "The task that lands second can get merge conflicts and redo its work.\n" +
        "  a/b#6 (workspace_ready):\n" +
        "    src/b.ts\n" +
        "    src/a.ts\n" +
        "  a/b#10 (awaiting_plan_review):\n" +
        "    src/c.ts\n" +
        "last.\n",
    );
  });

  it("gives only the fixed lines and the last line for no entry", () => {
    expect(overlapWarningText([], ["last."])).toBe(
      "WARNING: this plan changes files that other tasks in flight also change.\n" +
        "The task that lands second can get merge conflicts and redo its work.\n" +
        "last.\n",
    );
  });

  it("puts each line of lastLines at the end, in order", () => {
    expect(overlapWarningText([], ["first.", "second."])).toBe(
      "WARNING: this plan changes files that other tasks in flight also change.\n" +
        "The task that lands second can get merge conflicts and redo its work.\n" +
        "first.\n" +
        "second.\n",
    );
  });
});
