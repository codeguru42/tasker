import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueRef } from "../../../src/issue-key/ref.js";
import {
  blockersGraphqlArgs,
  blockersNode,
  blockersPageJson,
  configWithTrackers,
  failureOf,
  fakeGh,
  ghTokenAnswer,
  useTempDir,
} from "../../helpers.js";

const ref: IssueRef = { key: "octo/repo#7", repoKey: "octo/repo", shortRef: "issue-7" };
const token = ghTokenAnswer("octo", "gho_test");
const viewArgs = ["issue", "view", "7", "-R", "octo/repo", "--json", "number,title,body,url,labels,state"];
const loginArgs = ["api", "user", "--jq", ".login"];
const editArgs = (flag: string, value: string) => ["issue", "edit", "7", "-R", "octo/repo", flag, value];
const closeArgs = ["issue", "close", "7", "-R", "octo/repo", "--reason", "completed"];

// The modules load again before each test, so that each test starts with an empty token cache.
// Never import them at the top of this file: a second copy would have other error classes.
let providerModule: typeof import("../../../src/issues/github/provider.js");
let readModule: typeof import("../../../src/issues/github/issue.js");
let blockersModule: typeof import("../../../src/issues/github/blockers.js");
let writeModule: typeof import("../../../src/issues/github/write.js");
let authModule: typeof import("../../../src/issues/github/auth.js");
let doctorModule: typeof import("../../../src/issues/github/doctor.js");
let issue: typeof import("../../../src/issues/issue.js");
let resolve: typeof import("../../../src/issue-key/resolve.js");
let dir: string;

beforeEach(async () => {
  dir = useTempDir("tasker-github-provider-");
  vi.resetModules();
  providerModule = await import("../../../src/issues/github/provider.js");
  readModule = await import("../../../src/issues/github/issue.js");
  blockersModule = await import("../../../src/issues/github/blockers.js");
  writeModule = await import("../../../src/issues/github/write.js");
  authModule = await import("../../../src/issues/github/auth.js");
  doctorModule = await import("../../../src/issues/github/doctor.js");
  issue = await import("../../../src/issues/issue.js");
  resolve = await import("../../../src/issue-key/resolve.js");
});

describe("createGithubProvider", () => {
  // The repos in the list of doctorChecks(), with the defaults of the configuration.
  function repos() {
    const config = configWithTrackers({ "octo/repo": { provider: "github", account: "octo" } });
    return Object.entries(config.repos).map(([key, repo]) => ({ key, issueTracker: repo.issueTracker }));
  }

  const provider = () => providerModule.createGithubProvider({ account: "octo" });

  // The gh calls without the token call, which only the first run makes.
  const callsWithoutToken = (fake: ReturnType<typeof fakeGh>) =>
    fake.calls().map((call) => call.args).filter((args) => args[0] !== "auth" || args[1] !== "token");

  // Runs the member, then the direct call, with one fake gh. Gives the gh calls of each run.
  async function compareCalls(
    answers: Parameters<typeof fakeGh>[2],
    member: (env: NodeJS.ProcessEnv) => Promise<void>,
    direct: (env: NodeJS.ProcessEnv) => Promise<void>,
  ) {
    const fake = fakeGh(dir, {}, [token, ...answers]);
    await member(fake.env);
    const first = callsWithoutToken(fake);
    await direct(fake.env);
    const second = callsWithoutToken(fake).slice(first.length);
    fake.assertAnswered();
    return { first, second };
  }

  const fetchIssue = (env: NodeJS.ProcessEnv) => provider().fetchIssue(ref, env);
  const blockingIssues = (env: NodeJS.ProcessEnv) => provider().blockingIssues(ref, env);
  const authStatus = (env: NodeJS.ProcessEnv) => provider().authStatus(env);

  it("has the id github and the account of the pair", () => {
    expect(provider().id).toBe("github");
    expect(provider().account).toBe("octo");
  });

  it("uses the key parser of the github provider as parse", () => {
    expect(provider().parse).toBe(resolve.KEY_PARSERS.github);
  });

  it("uses the shared functions for baseBranchHint and inProgressMarker", () => {
    expect(provider().baseBranchHint).toBe(issue.baseBranchHint);
    expect(provider().inProgressMarker).toBe(issue.inProgressMarker);
  });

  it("reads an issue as readGithubIssue does", async () => {
    const stdout = JSON.stringify({
      number: 7,
      title: "T",
      body: "B",
      url: "https://github.com/octo/repo/issues/7",
      labels: [{ name: "bug" }],
      state: "OPEN",
    });
    const fake = fakeGh(dir, {}, [token, { args: viewArgs, stdout }]);
    const direct = await readModule.readGithubIssue(ref, "octo", fake.env);
    expect(await fetchIssue(fake.env)).toEqual(direct);
    expect(direct.title).toBe("T");
    fake.assertAnswered();
  });

  it("reads the blockers as readGithubBlockers does", async () => {
    const node = blockersNode(3, "OPEN", "octo/repo");
    const fake = fakeGh(dir, {}, [
      token,
      { args: blockersGraphqlArgs("octo", "repo", "7"), stdout: blockersPageJson([node]) },
    ]);
    const direct = await blockersModule.readGithubBlockers(ref, "octo", fake.env);
    expect(await blockingIssues(fake.env)).toEqual(direct);
    expect(direct).toEqual([{ key: "octo/repo#3", state: "open" }]);
    fake.assertAnswered();
  });

  it("reads the auth status as authStatus does", async () => {
    const fake = fakeGh(dir, {}, [token, { args: loginArgs, stdout: "octo\n" }]);
    const direct = await authModule.authStatus("octo", fake.env);
    expect(await authStatus(fake.env)).toEqual(direct);
    expect(direct.ok).toBe(true);
    fake.assertAnswered();
  });

  it("assigns as assignGithubIssue does", async () => {
    const { first, second } = await compareCalls(
      [{ args: editArgs("--add-assignee", "@me") }],
      (env) => provider().assign(ref, "@me", env),
      (env) => writeModule.assignGithubIssue(ref, "@me", "octo", env),
    );
    expect(first).toEqual([editArgs("--add-assignee", "@me")]);
    expect(first).toEqual(second);
  });

  it("transitions the status as markGithubInProgress does", async () => {
    const { first, second } = await compareCalls(
      [{ args: editArgs("--add-label", "wip") }],
      (env) => provider().transitionStatus(ref, "wip", env),
      (env) => writeModule.markGithubInProgress(ref, "wip", "octo", env),
    );
    expect(first).toEqual([editArgs("--add-label", "wip")]);
    expect(first).toEqual(second);
  });

  it("marks done with a label as markGithubDone does", async () => {
    const { first, second } = await compareCalls(
      [{ args: editArgs("--add-label", "done") }],
      (env) => provider().markDone(ref, "done", env),
      (env) => writeModule.markGithubDone(ref, "done", "octo", env),
    );
    expect(first).toEqual([editArgs("--add-label", "done")]);
    expect(first).toEqual(second);
  });

  it("marks done without a label as markGithubDone does", async () => {
    const { first, second } = await compareCalls(
      [{ args: closeArgs }],
      (env) => provider().markDone(ref, undefined, env),
      (env) => writeModule.markGithubDone(ref, undefined, "octo", env),
    );
    expect(first).toEqual([closeArgs]);
    expect(first).toEqual(second);
  });

  it("rejects with the IssueWriteError of the direct call", async () => {
    const stderr = "failed to update https://github.com/octo/repo/issues/7: HTTP 502\n";
    const fake = fakeGh(dir, {}, [token, { args: editArgs("--add-label", "wip"), exitCode: 1, stderr }]);
    const error = await failureOf(provider().transitionStatus(ref, "wip", fake.env), issue.IssueWriteError);
    const direct = await failureOf(
      writeModule.markGithubInProgress(ref, "wip", "octo", fake.env),
      issue.IssueWriteError,
    );
    expect(error.message).toBe(direct.message);
    fake.assertAnswered();
  });

  it("gives the doctor checks of the repos in the list",() => {
    const names = provider().doctorChecks(repos()).map((check) => check.name);
    expect(names).toEqual(doctorModule.githubDoctorChecks(repos()).map((check) => check.name));
    expect(names).toEqual(["gh version", "gh auth: octo", "gh project: octo/repo", "gh labels: octo/repo"]);
  });
});
