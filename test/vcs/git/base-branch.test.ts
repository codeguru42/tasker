import { describe, expect, it } from "vitest";
import { baseRevision, parseBaseInput } from "../../../src/vcs/git/base-branch.js";

describe("parseBaseInput", () => {
  it.each([
    ["origin/main", "main"],
    ["refs/remotes/origin/main", "main"],
    ["origin/feature/x", "feature/x"],
    ["refs/heads/task-1", "refs/heads/task-1"],
    ["main", "main"],
    ["-x", "-x"],
    ["a..b", "a..b"],
  ])("parses %j as %j", (input, expected) => {
    expect(parseBaseInput(input)).toBe(expected);
  });

  it.each(["", "origin/", "refs/remotes/origin/", "refs/heads/"])(
    "rejects the empty base %j",
    (input) => {
      expect(() => parseBaseInput(input)).toThrow("the base branch is empty");
    },
  );

  it.each(["origin/refs/heads/x", "refs/remotes/origin/refs/heads/x"])(
    "rejects %j as a local branch behind a remote prefix",
    (input) => {
      expect(() => parseBaseInput(input)).toThrow(
        `the base branch is not a branch name: ${input}`,
      );
    },
  );
});

describe("baseRevision", () => {
  it.each([
    ["main", "refs/remotes/origin/main"],
    ["feature/x", "refs/remotes/origin/feature/x"],
    ["refs/heads/task-1", "refs/heads/task-1"],
  ])("gives the revision of %j as %j", (base, expected) => {
    expect(baseRevision(base)).toBe(expected);
  });
});
