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

// The modules load again before each test, so that each test starts with an empty token cache.
// Never import them at the top of this file: a second copy would have other error classes.
let write: typeof import("../../../src/issues/github/write.js");
let gh: typeof import("../../../src/issues/github/run.js");
let keys: typeof import("../../../src/issue-key/ref.js");
let issue: typeof import("../../../src/issues/issue.js");
let dir: string;

beforeEach(async () => {
  dir = makeTempDir("tasker-write-issue-");
  vi.resetModules();
  write = await import("../../../src/issues/github/write.js");
  gh = await import("../../../src/issues/github/run.js");
  issue = await import("../../../src/issues/issue.js");
  keys = await import("../../../src/issue-key/ref.js");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("assignGithubIssue", () => {
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

describe("markGithubInProgress", () => {
  it("adds the label with one edit call", async () => {
    const fake = fakeGh(dir, {}, [token, { args: editArgs("--add-label", "wip") }]);
    await write.markGithubInProgress(ref, "wip", "octo", fake.env);
    expect(fake.calls().map((call) => call.args)).toEqual([token.args, editArgs("--add-label", "wip")]);
  });

  it("rejects with an IssueWriteError that names the configuration key when the label is missing", async () => {
    const stderr = editFailure("'wip' not found");
    const fake = fakeGh(dir, {}, [token, { args: editArgs("--add-label", "wip"), exitCode: 1, stderr }]);
    const error = await failureOf(write.markGithubInProgress(ref, "wip", "octo", fake.env), issue.IssueWriteError);
    expect(error.key).toBe("octo/repo#7");
    expect(error.configKey).toBe("issueTracker.inProgressLabel");
    expect(error.message).toBe(
      "could not add the label \"wip\" of issueTracker.inProgressLabel to octo/repo#7: gh issue edit failed with exit code 1: failed to update https://github.com/octo/repo/issues/7: 'wip' not found\nfailed to update 1 issue",
    );
    expect(fake.calls()).toHaveLength(2);
  });

  it("names the configuration key and no cause when the edit fails for another reason", async () => {
    const stderr = editFailure("HTTP 502");
    const fake = fakeGh(dir, {}, [token, { args: editArgs("--add-label", "wip"), exitCode: 1, stderr }]);
    const error = await failureOf(write.markGithubInProgress(ref, "wip", "octo", fake.env), issue.IssueWriteError);
    expect(error.key).toBe("octo/repo#7");
    expect(error.configKey).toBe("issueTracker.inProgressLabel");
    expect(error.message).toBe(
      "could not add the label \"wip\" of issueTracker.inProgressLabel to octo/repo#7: gh issue edit failed with exit code 1: failed to update https://github.com/octo/repo/issues/7: HTTP 502\nfailed to update 1 issue",
    );
    expect(fake.calls()).toHaveLength(2);
  });

  it("passes the GhError of a token call that a signal stops", async () => {
    const fake = fakeGh(dir, {}, [{ ...token, killWith: "TERM" }]);
    const error = await failureOf(write.markGithubInProgress(ref, "wip", "octo", fake.env), gh.GhError);
    expect(error).not.toBeInstanceOf(issue.IssueWriteError);
    expect(error.subcommand).toBe("auth token");
    expect(fake.calls()).toHaveLength(1);
  });

  it("passes the GhLoginError of a token call that fails", async () => {
    const stderr = "no oauth token found for github.com account octo\n";
    const fake = fakeGh(dir, {}, [{ ...token, stdout: "", stderr, exitCode: 1 }]);
    await failureOf(write.markGithubInProgress(ref, "wip", "octo", fake.env), gh.GhLoginError);
    expect(fake.calls()).toHaveLength(1);
  });
});
