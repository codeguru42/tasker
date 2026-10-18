import { describe, expect, it } from "vitest";
import { BaseHintError, type Issue, baseBranchHint, inProgressMarker } from "../../src/issues/issue.js";
import { thrownBy } from "../helpers/errors.js";

function issueWith(labels: string[]): Issue {
  return {
    ref: { key: "octo/repo#7", repoKey: "octo/repo", shortRef: "issue-7" },
    title: "A title",
    body: "",
    url: "https://github.com/octo/repo/issues/7",
    labels,
    state: "open",
  };
}

describe("baseBranchHint", () => {
  it("gives undefined for an issue with no labels", () => {
    expect(baseBranchHint(issueWith([]))).toBeUndefined();
  });

  it("gives undefined for labels with no base: label", () => {
    expect(baseBranchHint(issueWith(["bug"]))).toBeUndefined();
  });

  it.each([
    ["base:main", "main"],
    ["base:  release/1.2  ", "release/1.2"],
    ["base:\tmain\n", "main"],
    ["base: x", "x"],
    ["base:fêature-ü", "fêature-ü"],
    ["base:🚀", "🚀"],
    ["base:refs/heads/x", "refs/heads/x"],
    ["Base:x", "x"],
    ["BASE:x", "x"],
    ["bAsE:x", "x"],
    ["base:Mixed-Case", "Mixed-Case"],
  ])("reads the hint of the label %j as %j", (label, hint) => {
    expect(baseBranchHint(issueWith(["bug", label]))).toBe(hint);
  });

  it.each(["\u212Aase:x", " base:x", "bug fix", "basement"])("gives undefined for the label %j", (label) => {
    expect(baseBranchHint(issueWith([label]))).toBeUndefined();
  });

  it.each(["base:", "base:   ", "base: \t "])("throws BaseHintError for the empty label %j", (label) => {
    const issue = issueWith([label]);
    const error = thrownBy(() => baseBranchHint(issue), "a BaseHintError");
    expect(error).toBeInstanceOf(BaseHintError);
    const hintError = error as BaseHintError;
    expect(hintError.labels).toEqual([label]);
    expect(hintError.message).toContain(JSON.stringify(label));
    expect(hintError.message).toContain("octo/repo#7");
  });

  it.each([
    [
      ["base:main", "bug", "base:dev"],
      ["base:main", "base:dev"],
    ],
    [
      ["base:a", "base:b", "base:c"],
      ["base:a", "base:b", "base:c"],
    ],
    [
      ["base:", "base:main"],
      ["base:", "base:main"],
    ],
    [
      ["base:a", "BASE:b"],
      ["base:a", "BASE:b"],
    ],
    [
      ["base:main", "Base:main"],
      ["base:main", "Base:main"],
    ],
  ])("throws BaseHintError for the labels %j", (labels, found) => {
    const error = thrownBy(() => baseBranchHint(issueWith(labels)), "a BaseHintError");
    expect(error).toBeInstanceOf(BaseHintError);
    const hintError = error as BaseHintError;
    expect(hintError.labels).toEqual(found);
    for (const label of found) {
      expect(hintError.message).toContain(JSON.stringify(label));
    }
    expect(hintError.message).toContain("octo/repo#7");
  });
});

describe("inProgressMarker", () => {
  it("gives false when the label is undefined", () => {
    expect(inProgressMarker(issueWith(["wip"]), undefined)).toBe(false);
  });

  it("gives false for an issue with no labels", () => {
    expect(inProgressMarker(issueWith([]), "wip")).toBe(false);
  });

  it("gives false when the issue lacks the label", () => {
    expect(inProgressMarker(issueWith(["bug"]), "wip")).toBe(false);
  });

  it.each([
    ["wip", "wip", true],
    ["In Progress", "in progress", true],
    ["ÜBER", "über", true],
    ["BASE:X", "base:x", true],
    ["base:", "base:", true],
    ["wip ", "wip", false],
  ])("compares the issue label %j with the asked label %j: %s", (name, asked, expected) => {
    expect(inProgressMarker(issueWith(["bug", name]), asked)).toBe(expected);
  });
});
