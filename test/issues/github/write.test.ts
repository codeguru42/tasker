import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueRef } from "../../../src/issue-key/ref.js";
import { failureOf, fakeGh, ghTokenAnswer, makeTempDir } from "../../helpers.js";

// The call of an issue edit. The args are a literal, so that the test checks the call on its own.
const editArgs = (flag: string, value: string, number = "7", project = "octo/repo") => [
  "issue",
  "edit",
  number,
  "-R",
  project,
  flag,
  value,
];

// The stderr that gh prints when an issue edit fails.
const editFailure = (detail: string) =>
  `failed to update https://github.com/octo/repo/issues/7: ${detail}\nfailed to update 1 issue\n`;

const ref: IssueRef = { key: "octo/repo#7", repoKey: "octo/repo", shortRef: "issue-7" };
const token = ghTokenAnswer("octo", "gho_test");

describe("assignGithubIssue", () => {
  // The modules load again before each test, so that each test starts with an empty token cache.
  // Never import them at the top of this file: a second copy would have other error classes.
  let write: typeof import("../../../src/issues/github/write.js");
  let gh: typeof import("../../../src/issues/github/run.js");
  let keys: typeof import("../../../src/issue-key/ref.js");
  let dir: string;

  beforeEach(async () => {
    dir = makeTempDir("tasker-write-issue-");
    vi.resetModules();
    write = await import("../../../src/issues/github/write.js");
    gh = await import("../../../src/issues/github/run.js");
    keys = await import("../../../src/issue-key/ref.js");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes @me to gh as it is", async () => {
    const fake = fakeGh(dir, {}, [token, { args: editArgs("--add-assignee", "@me") }]);
    await write.assignGithubIssue(ref, "@me", "octo", fake.env);
    expect(fake.calls().map((call) => call.args)).toEqual([token.args, editArgs("--add-assignee", "@me")]);
    expect(fake.calls()[1].ghToken).toBe("gho_test");
  });

  it("passes a named assignee to gh as it is", async () => {
    const fake = fakeGh(dir, {}, [token, { args: editArgs("--add-assignee", "octocat") }]);
    await write.assignGithubIssue(ref, "octocat", "octo", fake.env);
    expect(fake.calls().map((call) => call.args)).toEqual([token.args, editArgs("--add-assignee", "octocat")]);
  });

  it("keeps the spelling of the project in the key", async () => {
    const mixed: IssueRef = { key: "Octo/Repo#7", repoKey: "tasker", shortRef: "issue-7" };
    const args = editArgs("--add-assignee", "@me", "7", "Octo/Repo");
    const fake = fakeGh(dir, {}, [token, { args }]);
    await write.assignGithubIssue(mixed, "@me", "octo", fake.env);
    expect(fake.calls().map((call) => call.args)).toEqual([token.args, args]);
  });

  it("rejects with the GhError of a failed edit", async () => {
    const stderr = editFailure("HTTP 502");
    const fake = fakeGh(dir, {}, [token, { args: editArgs("--add-assignee", "@me"), exitCode: 1, stderr }]);
    const error = await failureOf(write.assignGithubIssue(ref, "@me", "octo", fake.env), gh.GhError);
    expect(error.stderr).toBe(stderr);
    expect(fake.calls()).toHaveLength(2);
  });

  it("rejects a key of another tracker before gh starts", async () => {
    const jira: IssueRef = { key: "PROJ-7", repoKey: "tasker", shortRef: "issue-7" };
    const fake = fakeGh(dir, {}, []);
    await failureOf(write.assignGithubIssue(jira, "@me", "octo", fake.env), keys.IssueKeyError);
    expect(fake.calls()).toEqual([]);
  });
});
