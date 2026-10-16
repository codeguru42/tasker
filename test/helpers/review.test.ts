import { describe, expect, it } from "vitest";
import { checkReviewAnswer } from "../../src/review/answer.js";
import { findingEntries, findingText, reviewFinding, reviewFindingWithout, validReviewAnswer } from "./review.js";

function finding(change?: Parameters<typeof reviewFinding>[0]) {
  return reviewFinding(change);
}

function findingWithout(...keys: Parameters<typeof reviewFindingWithout>) {
  return reviewFindingWithout(...keys);
}

function text(...args: Parameters<typeof findingText>) {
  return findingText(...args);
}

function answer(change?: Parameters<typeof validReviewAnswer>[0]) {
  return validReviewAnswer(change);
}

describe("reviewFinding", () => {
  it("has the five keys", () => {
    expect(Object.keys(finding()).sort()).toEqual(["category", "failure_scenario", "file", "line", "summary"]);
  });

  it("changes only the keys that the caller gives", () => {
    expect(finding({ line: 9 })).toEqual({ ...finding(), line: 9 });
  });
});

describe("reviewFindingWithout", () => {
  it("leaves out the keys that the caller names", () => {
    expect(Object.keys(findingWithout("line", "category")).sort()).toEqual(["failure_scenario", "file", "summary"]);
  });

  it("keeps the values of the keys that stay", () => {
    const { file, summary, failure_scenario } = finding();
    expect(findingWithout("line", "category")).toEqual({ file, summary, failure_scenario });
  });

  it("gives the whole finding when the caller names no key", () => {
    expect(findingWithout()).toEqual(finding());
  });
});

describe("validReviewAnswer", () => {
  it("passes the check of the review answer", () => {
    expect(checkReviewAnswer(answer())).toEqual({ ok: true, answer: answer() });
  });

  it("holds one finding", () => {
    expect(answer().findings).toEqual([finding()]);
  });
});

describe("findingText", () => {
  it("gives the text of the first default finding", () => {
    expect(text("first", 1)).toBe(
      "- [1] src/a.ts:3 (correctness): The loop skips the last item.\n" +
        "  failure scenario: A list of two items gives only the first one.\n" +
        "  status: open\n",
    );
  });

  it("gives the text of the second default finding", () => {
    expect(text("second", 2)).toBe(
      "- [2] src/b.ts:9 (correctness): The count is off by one.\n" +
        "  failure scenario: A list of three items gives the count 2.\n" +
        "  status: open\n",
    );
  });

  it("puts the position and the status in the text", () => {
    const result = text("first", 3, "dismissed: Not a bug.");
    expect(result.startsWith("- [3] ")).toBe(true);
    expect(result.endsWith("  status: dismissed: Not a bug.\n")).toBe(true);
  });
});

describe("findingEntries", () => {
  it("gives open entries with positions from 1", () => {
    const second = reviewFinding({ file: "src/b.ts", line: 9 });
    expect(findingEntries([reviewFinding(), second])).toEqual([
      { position: 1, finding: reviewFinding(), dismissed: null },
      { position: 2, finding: second, dismissed: null },
    ]);
  });

  it("gives no entry for no finding", () => {
    expect(findingEntries([])).toEqual([]);
  });
});
