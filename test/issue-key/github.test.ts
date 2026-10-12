import { describe, expect, it } from "vitest";
import { parseGithubKey, splitGithubKey } from "../../src/issue-key/github.js";
import { IssueKeyError } from "../../src/issue-key/ref.js";

const NOT_GITHUB_KEYS = [
  "",
  "8",
  "#8",
  "codeguru42/tasker",
  "codeguru42/tasker#",
  "codeguru42/tasker#0",
  "codeguru42/tasker#08",
  "codeguru42/tasker#x",
  "codeguru42/tasker/x#8",
  "-org/tasker#8",
  "org-/tasker#8",
  "org/.#8",
  "org/..#8",
  " codeguru42/tasker#8",
  "codeguru42/tasker#8 ",
  "PROJ-8",
  "https://github.com/codeguru42/tasker/issues/8",
];

describe("parseGithubKey", () => {
  it("parses an owner/repo#N key", () => {
    expect(
      parseGithubKey("codeguru42/tasker#8", "codeguru42/tasker"),
    ).toStrictEqual({
      key: "codeguru42/tasker#8",
      repoKey: "codeguru42/tasker",
      shortRef: "issue-8",
    });
  });

  it("returns the repo key as passed", () => {
    expect(parseGithubKey("Some-Org/my.repo_x#1234", "other-key")).toStrictEqual(
      {
        key: "Some-Org/my.repo_x#1234",
        repoKey: "other-key",
        shortRef: "issue-1234",
      },
    );
  });

  it.each(NOT_GITHUB_KEYS)("rejects %j", (rawKey) => {
    let error: unknown;
    try {
      parseGithubKey(rawKey, "r");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(IssueKeyError);
    expect((error as IssueKeyError).key).toBe(rawKey);
    expect((error as IssueKeyError).message).toBe(
      `not a GitHub issue key: ${JSON.stringify(rawKey)} (expected owner/repo#N)`,
    );
  });
});

describe("splitGithubKey", () => {
  it("gives the project and the number of an owner/repo#N key", () => {
    expect(splitGithubKey("codeguru42/tasker#8")).toStrictEqual({
      project: "codeguru42/tasker",
      number: "8",
    });
  });

  it("keeps the case of the key", () => {
    expect(splitGithubKey("Some-Org/my.repo_x#1234")).toStrictEqual({
      project: "Some-Org/my.repo_x",
      number: "1234",
    });
  });

  it.each(NOT_GITHUB_KEYS)("rejects %j", (rawKey) => {
    let error: unknown;
    try {
      splitGithubKey(rawKey);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(IssueKeyError);
    expect((error as IssueKeyError).key).toBe(rawKey);
    expect((error as IssueKeyError).message).toBe(
      `not a GitHub issue key: ${JSON.stringify(rawKey)} (expected owner/repo#N)`,
    );
  });
});
