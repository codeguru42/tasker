import { describe, expect, it } from "vitest";
import { checkReviewAnswer } from "../../src/review/answer.js";
import { reviewFinding, reviewFindingWithout, validReviewAnswer } from "./review.js";

function finding(change?: Parameters<typeof reviewFinding>[0]) {
  return reviewFinding(change);
}

function findingWithout(...keys: Parameters<typeof reviewFindingWithout>) {
  return reviewFindingWithout(...keys);
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
