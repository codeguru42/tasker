import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueRef } from "../../../src/issue-key/ref.js";
import { failureOf } from "../../helpers/errors.js";
import { fakeGh, ghTokenAnswer } from "../../helpers/fake-gh.js";
import { useTempDir } from "../../helpers/temp.js";

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

// The call of an issue close.
const closeArgs = ["issue", "close", "7", "-R", "octo/repo", "--reason", "completed"];

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
  dir = useTempDir("tasker-write-issue-");
  vi.resetModules();
  write = await import("../../../src/issues/github/write.js");
  gh = await import("../../../src/issues/github/run.js");
  issue = await import("../../../src/issues/issue.js");
  keys = await import("../../../src/issue-key/ref.js");
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

describe("markGithubDone without a done label", () => {
  it("closes the issue as completed with one close call", async () => {
    const fake = fakeGh(dir, {}, [token, { args: closeArgs }]);
    await write.markGithubDone(ref, undefined, "octo", fake.env);
    expect(fake.calls().map((call) => call.args)).toEqual([token.args, closeArgs]);
  });

  it("resolves for an issue that is already closed", async () => {
    const stderr = "! Issue octo/repo#7 (T) is already closed\n";
    const fake = fakeGh(dir, {}, [token, { args: closeArgs, stderr }]);
    await expect(write.markGithubDone(ref, undefined, "octo", fake.env)).resolves.toBeUndefined();
    expect(fake.calls().map((call) => call.args)).toEqual([token.args, closeArgs]);
  });

  it("rejects with the GhError of a failed close", async () => {
    const fake = fakeGh(dir, {}, [token, { args: closeArgs, exitCode: 1, stderr: "HTTP 502" }]);
    const error = await failureOf(write.markGithubDone(ref, undefined, "octo", fake.env), gh.GhError);
    expect(error.message).toBe("gh issue close failed with exit code 1: HTTP 502");
    expect(fake.calls()).toHaveLength(2);
  });
});

describe("markGithubDone with a done label", () => {
  it("adds the label with one edit call and does not close the issue", async () => {
    const fake = fakeGh(dir, {}, [token, { args: editArgs("--add-label", "done") }]);
    await write.markGithubDone(ref, "done", "octo", fake.env);
    expect(fake.calls().map((call) => call.args)).toEqual([token.args, editArgs("--add-label", "done")]);
  });

  it("rejects with an IssueWriteError that names the configuration key when the label is missing", async () => {
    const stderr = editFailure("'done' not found");
    const fake = fakeGh(dir, {}, [token, { args: editArgs("--add-label", "done"), exitCode: 1, stderr }]);
    const error = await failureOf(write.markGithubDone(ref, "done", "octo", fake.env), issue.IssueWriteError);
    expect(error.key).toBe("octo/repo#7");
    expect(error.configKey).toBe("issueTracker.doneLabel");
    expect(error.message).toBe(
      "could not add the label \"done\" of issueTracker.doneLabel to octo/repo#7: gh issue edit failed with exit code 1: failed to update https://github.com/octo/repo/issues/7: 'done' not found\nfailed to update 1 issue",
    );
    expect(fake.calls()).toHaveLength(2);
  });
});
