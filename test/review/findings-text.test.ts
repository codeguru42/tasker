import { describe, expect, it } from "vitest";
import { type FindingEntry, findingCountText, formatFindings } from "../../src/review/findings-text.js";
import { reviewFinding, reviewFindingWithout } from "../helpers/review.js";

function format(entries: readonly FindingEntry[]): string {
  return formatFindings(entries);
}

function countOf(count: number): string {
  return findingCountText(count);
}

function entry(change: Partial<FindingEntry> = {}): FindingEntry {
  return { position: 1, finding: reviewFinding(), dismissed: null, ...change };
}

describe("formatFindings", () => {
  it("prints each key of an open finding", () => {
    expect(format([entry()])).toBe(
      "- [1] src/a.ts:3 (correctness): The loop skips the last item.\n" +
        "  failure scenario: A list of two items gives only the first one.\n" +
        "  status: open\n",
    );
  });

  it("leaves out the line when the finding has none", () => {
    expect(format([entry({ finding: reviewFindingWithout("line") })]).split("\n")[0]).toBe(
      "- [1] src/a.ts (correctness): The loop skips the last item.",
    );
  });

  it("leaves out the category when the finding has none", () => {
    expect(format([entry({ finding: reviewFindingWithout("category") })]).split("\n")[0]).toBe(
      "- [1] src/a.ts:3: The loop skips the last item.",
    );
  });

  it("prints the reason of a dismissed finding", () => {
    const dismissed = { at: "2026-10-15T00:00:00.000Z", reason: "Not a bug." };
    expect(format([entry({ dismissed })]).split("\n")[2]).toBe("  status: dismissed: Not a bug.");
  });

  it("keeps the indent after a line end in the summary", () => {
    const finding = reviewFinding({ summary: "A.\nB." });
    expect(format([entry({ finding })]).startsWith("- [1] src/a.ts:3 (correctness): A.\n  B.\n")).toBe(true);
  });

  it("keeps the indent after a line end in the failure scenario", () => {
    const finding = reviewFinding({ failure_scenario: "X.\nY." });
    expect(format([entry({ finding })])).toContain("  failure scenario: X.\n  Y.\n");
  });

  it("keeps the indent after a line end in the reason", () => {
    const dismissed = { at: "2026-10-15T00:00:00.000Z", reason: "X.\nY." };
    expect(format([entry({ dismissed })])).toContain("  status: dismissed: X.\n  Y.\n");
  });

  it("prints no findings for an empty list", () => {
    expect(format([])).toBe("no findings\n");
  });

  it("prints the entries in input order with their own positions and no blank line", () => {
    const text = format([
      entry({ position: 2, finding: reviewFinding({ summary: "First." }) }),
      entry({ position: 5, finding: reviewFinding({ summary: "Second." }) }),
    ]);
    expect(text).toBe(
      "- [2] src/a.ts:3 (correctness): First.\n" +
        "  failure scenario: A list of two items gives only the first one.\n" +
        "  status: open\n" +
        "- [5] src/a.ts:3 (correctness): Second.\n" +
        "  failure scenario: A list of two items gives only the first one.\n" +
        "  status: open\n",
    );
  });
});

describe("findingCountText", () => {
  it.each([
    [0, "no findings"],
    [1, "1 finding"],
    [2, "2 findings"],
    [10, "10 findings"],
  ])("gives the text of %i findings", (count, text) => {
    expect(countOf(count)).toBe(text);
  });
});
