import { describe, expect, it } from "vitest";
import { BaseHintError, baseBranchHint, inProgressMarker } from "../../src/issues/issue.js";
import { thrownBy } from "../helpers/errors.js";
import { issueOf } from "../helpers/issue.js";

describe("baseBranchHint", () => {
  it("gives undefined for an issue with no labels", () => {
    expect(baseBranchHint(issueOf({ labels: [] }))).toBeUndefined();
  });

  it("gives undefined for labels with no base: label", () => {
    expect(baseBranchHint(issueOf({ labels: ["bug"] }))).toBeUndefined();
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
    expect(baseBranchHint(issueOf({ labels: ["bug", label] }))).toBe(hint);
  });

  it.each(["\u212Aase:x", " base:x", "bug fix", "basement"])("gives undefined for the label %j", (label) => {
    expect(baseBranchHint(issueOf({ labels: [label] }))).toBeUndefined();
  });

  it.each(["base:", "base:   ", "base: \t "])("throws BaseHintError for the empty label %j", (label) => {
    const issue = issueOf({ labels: [label] });
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
    const error = thrownBy(() => baseBranchHint(issueOf({ labels: labels })), "a BaseHintError");
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
    expect(inProgressMarker(issueOf({ labels: ["wip"] }), undefined)).toBe(false);
  });

  it("gives false for an issue with no labels", () => {
    expect(inProgressMarker(issueOf({ labels: [] }), "wip")).toBe(false);
  });

  it("gives false when the issue lacks the label", () => {
    expect(inProgressMarker(issueOf({ labels: ["bug"] }), "wip")).toBe(false);
  });

  it.each([
    ["wip", "wip", true],
    ["In Progress", "in progress", true],
    ["ÜBER", "über", false],
    ["\u212Aey", "key", false],
    ["BASE:X", "base:x", true],
    ["base:", "base:", true],
    ["wip ", "wip", false],
  ])("compares the issue label %j with the asked label %j: %s", (name, asked, expected) => {
    expect(inProgressMarker(issueOf({ labels: ["bug", name] }), asked)).toBe(expected);
  });
});
