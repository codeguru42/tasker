import { describe, expect, it } from "vitest";
import { checkReviewAnswer } from "../../src/review/answer.js";
import { reviewFinding, validReviewAnswer } from "./review.js";

function finding(change?: Parameters<typeof reviewFinding>[0]) {
  return reviewFinding(change);
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

describe("validReviewAnswer", () => {
  it("passes the check of the review answer", () => {
    expect(checkReviewAnswer(answer())).toEqual({ ok: true, answer: answer() });
  });

  it("holds one finding", () => {
    expect(answer().findings).toEqual([finding()]);
  });
});
