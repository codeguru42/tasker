import { beforeEach, describe, expect, it } from "vitest";
import { IssueKeyError, type IssueRef } from "../../../src/issue-key/ref.js";
import { readGithubIssue } from "../../../src/issues/github/issue.js";
import { GhError } from "../../../src/issues/github/run.js";
import { IssueReadError } from "../../../src/issues/issue.js";
import { failureOf } from "../../helpers/errors.js";
import { fakeGh, ghTokenAnswer } from "../../helpers/fake-gh.js";
import { useTempDir } from "../../helpers/temp.js";

// The call of readGithubIssue(). The field list is a literal, so that the test checks the call on its own.
const viewArgs = (number: string, project: string) => [
  "issue",
  "view",
  number,
  "-R",
  project,
  "--json",
  "number,title,body,url,labels,state",
];

// The JSON that gh prints for an issue.
function issueJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    number: 7,
    title: "T",
    body: "B",
    url: "https://github.com/octo/repo/issues/7",
    labels: [{ id: "LA_1", name: "bug", description: "", color: "d73a4a" }],
    state: "OPEN",
    ...overrides,
  });
}

const ref: IssueRef = { key: "octo/repo#7", repoKey: "octo/repo", shortRef: "issue-7" };

describe("readGithubIssue", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-read-issue-");
  });

  // A fake gh with the answer of the token call and the answer of the view call.
  function fakeWith(stdout: string, key = "octo/repo#7") {
    const [project, number] = key.split("#");
    return fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: viewArgs(number, project), stdout }]);
  }

  it("reads an open issue", async () => {
    const fake = fakeWith(issueJson());
    await expect(readGithubIssue(ref, "octo", fake.env)).resolves.toEqual({
      ref,
      title: "T",
      body: "B",
      url: "https://github.com/octo/repo/issues/7",
      labels: ["bug"],
      state: "open",
      comments: [],
    });
  });

  it("reads a closed issue", async () => {
    const fake = fakeWith(issueJson({ state: "CLOSED" }));
    const issue = await readGithubIssue(ref, "octo", fake.env);
    expect(issue.state).toBe("closed");
  });

  it.each([
    ["an empty body", { body: "" }],
    ["a null body", { body: null }],
    ["a missing body", { body: undefined }],
  ])("gives an empty body for %s", async (_name, overrides) => {
    const fake = fakeWith(issueJson(overrides));
    const issue = await readGithubIssue(ref, "octo", fake.env);
    expect(issue.body).toBe("");
  });

  it("takes the project and the number from the key", async () => {
    const odd: IssueRef = { key: "Octo/Repo#7", repoKey: "tasker", shortRef: "issue-7" };
    const fake = fakeWith(issueJson(), odd.key);
    await readGithubIssue(odd, "octo", fake.env);
    expect(fake.calls().map((call) => call.args)).toContainEqual(viewArgs("7", "Octo/Repo"));
  });

  it("runs the view call with the token of the account", async () => {
    const fake = fakeWith(issueJson());
    await readGithubIssue(ref, "octo", fake.env);
    const view = fake.calls().find((call) => call.args[0] === "issue");
    expect(view?.ghToken).toBe("gho_test");
  });

  it.each([" spaced ", "base:", "BASE:x", "ünïcode 🚀"])("passes the label name %j as gh gives it", async (name) => {
    const fake = fakeWith(issueJson({ labels: [{ name }] }));
    const issue = await readGithubIssue(ref, "octo", fake.env);
    expect(issue.labels).toEqual([name]);
  });

  it.each(["PROJ-7", "octo/repo", "octo/repo#0"])("rejects the key %j before gh starts", async (key) => {
    const fake = fakeGh(dir, {}, []);
    const bad: IssueRef = { key, repoKey: "octo/repo", shortRef: "issue-7" };
    const error = await failureOf(readGithubIssue(bad, "octo", fake.env), IssueKeyError);
    expect(error.key).toBe(key);
    expect(fake.calls()).toEqual([]);
  });

  it.each([
    ["a missing repo", "GraphQL: Could not resolve to a Repository with the name 'octo/repo'. (repository)\n"],
    ["a server error", "HTTP 502"],
  ])("passes %s through as a GhError", async (_name, stderr) => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: viewArgs("7", "octo/repo"), stderr, exitCode: 1 },
    ]);
    const error = await failureOf(readGithubIssue(ref, "octo", fake.env), GhError);
    expect(error.stderr).toBe(stderr);
  });

  it("names the key of an issue that does not exist", async () => {
    const stderr = "GraphQL: Could not resolve to an issue or pull request with the number of 7. (repository.issue)\n";
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: viewArgs("7", "octo/repo"), stderr, exitCode: 1 },
    ]);
    const error = await failureOf(readGithubIssue(ref, "octo", fake.env), IssueReadError);
    expect(error.key).toBe("octo/repo#7");
    expect(error.message).toMatch(/^the issue octo\/repo#7 does not exist: GraphQL: Could not resolve/);
  });

  it.each(["OPEN", "CLOSED", "MERGED"])("refuses a pull request in the state %s", async (state) => {
    const fake = fakeWith(issueJson({ state, url: "https://github.com/octo/repo/pull/7" }));
    const error = await failureOf(readGithubIssue(ref, "octo", fake.env), IssueReadError);
    expect(error.key).toBe("octo/repo#7");
    expect(error.message).toBe("octo/repo#7 is a pull request, not an issue");
  });

  it.each([
    ["pull/repo#7", "https://github.com/pull/repo/issues/7"],
    ["octo/pull#7", "https://github.com/octo/pull/issues/7"],
  ])("reads the issue %s as an issue", async (key, url) => {
    const named: IssueRef = { key, repoKey: key.split("#")[0], shortRef: "issue-7" };
    const fake = fakeWith(issueJson({ url }), key);
    const issue = await readGithubIssue(named, "octo", fake.env);
    expect(issue.url).toBe(url);
    expect(issue.state).toBe("open");
  });

  it.each([
    ["output that is not JSON", "not json"],
    ["JSON with no fields", "{}"],
    ["the wrong number", issueJson({ number: 8 })],
    ["an unknown state", issueJson({ state: "DRAFT" })],
    ["the state MERGED with an issue url", issueJson({ state: "MERGED" })],
    ["labels that are not an array", issueJson({ labels: "bug" })],
    ["a url that does not parse", issueJson({ url: "not a url" })],
    ["a discussion url", issueJson({ url: "https://github.com/octo/repo/discussions/7" })],
    ["a url with an extra part", issueJson({ url: "https://github.com/octo/repo/issues/7/extra" })],
    ["a url with a slash at the end", issueJson({ url: "https://github.com/octo/repo/issues/7/" })],
  ])("gives a bad-output error for %s", async (_name, stdout) => {
    const fake = fakeWith(stdout);
    const error = await failureOf(readGithubIssue(ref, "octo", fake.env), IssueReadError);
    expect(error.key).toBe("octo/repo#7");
    expect(error.message).toMatch(/^gh issue view gave bad output for octo\/repo#7:/);
  });
});
