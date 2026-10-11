import { describe, expect, it } from "vitest";
import { parseGithubKey } from "../../src/issue-key/github.js";

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
});
