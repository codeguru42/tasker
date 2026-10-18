import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readGithubBlockers } from "../../src/issues/github/blockers.js";
import { readGithubIssue } from "../../src/issues/github/issue.js";
import {
  blockerReadCalls,
  fakeGh,
  ghTokenAnswer,
  githubBlockersAnswer,
  githubIssueAnswer,
  githubLabelsAfter,
  githubWriteAnswer,
  trackerWriteCalls,
  writeFakeGh,
} from "./fake-gh.js";
import { useTempDir } from "./temp.js";

describe("fakeGh", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-fake-gh-");
  });

  const run = (env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync("gh", args, { env, encoding: "utf8" });

  it("answers a listed call with the stdout, stderr and exit code of its answer", () => {
    const gh = fakeGh(dir, {}, [{ args: ["issue", "view", "7"], stdout: "out\n", stderr: "err\n", exitCode: 3 }]);
    const result = run(gh.env, "issue", "view", "7");
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
    expect(result.status).toBe(3);
  });

  it("waits delaySeconds before it prints the stdout", () => {
    const gh = fakeGh(dir, {}, [{ args: ["slow"], stdout: "late\n", delaySeconds: 0.3 }]);
    const start = Date.now();
    const result = run(gh.env, "slow");
    expect(Date.now() - start).toBeGreaterThanOrEqual(250);
    expect(result.stdout).toBe("late\n");
    expect(result.status).toBe(0);
  });

  it("throws for a delay that is not a plain number of seconds", () => {
    expect(() => fakeGh(dir, {}, [{ args: ["slow"], delaySeconds: -1 }])).toThrow("bad delay for the fake gh: -1");
  });

  it("matches an argument with spaces, quotes and a newline", () => {
    const odd = "a b 'c' \"d\"\ne";
    const gh = fakeGh(dir, {}, [{ args: ["api", odd], stdout: "ok" }]);
    expect(run(gh.env, "api", odd).stdout).toBe("ok");
  });

  it("does not match a call with one more argument or another order", () => {
    const gh = fakeGh(dir, {}, [{ args: ["a", "b"], stdout: "ok" }]);
    expect(run(gh.env, "a", "b", "c").status).toBe(99);
    expect(run(gh.env, "b", "a").status).toBe(99);
    expect(run(gh.env, "a").status).toBe(99);
    expect(gh.unanswered()).toEqual([["a", "b", "c"], ["b", "a"], ["a"]]);
    // Clear the log, so that the check of fakeGh() at the end of the test passes.
    rmSync(`${gh.logPath}.unanswered`);
  });

  it("answers a call with no arguments", () => {
    const gh = fakeGh(dir, {}, [{ args: [], stdout: "none" }]);
    expect(run(gh.env).stdout).toBe("none");
  });

  it("uses the first answer when two answers have the same arguments", () => {
    const gh = fakeGh(dir, {}, [
      { args: ["x"], stdout: "first" },
      { args: ["x"], stdout: "second" },
    ]);
    expect(run(gh.env, "x").stdout).toBe("first");
  });

  it("logs the arguments of each call and the GH_TOKEN value", () => {
    const gh = fakeGh(dir, {}, [{ args: ["x"] }, { args: ["y", "z"] }]);
    run(gh.env, "x");
    run({ ...gh.env, GH_TOKEN: "tok" }, "y", "z");
    expect(gh.calls()).toEqual([
      { args: ["x"], ghToken: undefined, env: {} },
      { args: ["y", "z"], ghToken: "tok", env: {} },
    ]);
  });

  it("logs each logEnv name: a value, an empty value and a name that is not set", () => {
    const gh = fakeGh(dir, {}, [{ args: ["x"] }], { logEnv: ["A_ONE", "B_TWO", "C_THREE"] });
    run({ ...gh.env, A_ONE: "1", B_TWO: "" }, "x");
    expect(gh.calls()).toEqual([
      {
        args: ["x"],
        ghToken: undefined,
        env: { A_ONE: "1", B_TWO: "", C_THREE: undefined },
      },
    ]);
  });

  it("gives ghTokenAnswer() the arguments of the token call", () => {
    const gh = fakeGh(dir, {}, [ghTokenAnswer("octo", "tok")]);
    const result = run(gh.env, "auth", "token", "--hostname", "github.com", "--user", "octo");
    expect(result.stdout).toBe("tok\n");
    expect(result.status).toBe(0);
  });

  it("stops by a signal after it prints, with killWith", () => {
    const gh = fakeGh(dir, {}, [{ args: ["x"], stdout: "partial", killWith: "TERM" }]);
    const result = run(gh.env, "x");
    expect(result.stdout).toBe("partial");
    expect(result.signal).toBe("SIGTERM");
    expect(result.status).toBeNull();
  });

  it("exits with 99 on a call with no answer and lists the call", () => {
    const gh = fakeGh(dir, {}, [{ args: ["x"] }]);
    const result = run(gh.env, "nope", "1");
    expect(result.status).toBe(99);
    expect(result.stderr).toContain("fake gh: no answer for: nope 1");
    expect(gh.unanswered()).toEqual([["nope", "1"]]);
    expect(() => gh.assertAnswered()).toThrow();
    // Clear the log, so that the check of fakeGh() at the end of the test passes.
    rmSync(`${gh.logPath}.unanswered`);
  });

  it("does not throw from assertAnswered() when every call has an answer", () => {
    const gh = fakeGh(dir, {}, [{ args: ["x"] }]);
    run(gh.env, "x");
    expect(() => gh.assertAnswered()).not.toThrow();
  });

  it("puts only its own bin folder on the PATH", () => {
    const gh = fakeGh(dir, { HOME: dir }, []);
    expect(gh.env.PATH).toBe(join(dir, "bin"));
    expect(gh.env.HOME).toBe(dir);
  });

  it("throws for a logEnv name that is not a name", () => {
    expect(() => writeFakeGh(join(dir, "bin"), join(dir, "gh.log"), [], ["A B"])).toThrow();
  });

  it("throws for a killWith value that is not a signal name", () => {
    expect(() => writeFakeGh(join(dir, "bin"), join(dir, "gh.log"), [{ args: [], killWith: "TERM; rm" }])).toThrow();
  });
});

describe("githubIssueAnswer", () => {
  it("answers the view call of an issue with the JSON of gh", () => {
    const answer = githubIssueAnswer({ project: "octo/repo", number: 7, labels: ["bug"] });

    expect(answer.args).toEqual([
      "issue",
      "view",
      "7",
      "-R",
      "octo/repo",
      "--json",
      "number,title,body,url,labels,state",
    ]);
    expect(JSON.parse(answer.stdout ?? "")).toMatchObject({
      number: 7,
      title: "Issue 7",
      url: "https://github.com/octo/repo/issues/7",
      labels: [{ name: "bug" }],
      state: "OPEN",
    });
  });

  it("gives an issue to readGithubIssue through the fake gh", async () => {
    const dir = useTempDir("tasker-issue-answer-");
    const gh = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      githubIssueAnswer({ project: "octo/repo", number: 7, title: "T", state: "CLOSED", labels: ["bug"] }),
    ]);
    const ref = { key: "octo/repo#7", repoKey: "repo", shortRef: "octo-repo-7" };

    const issue = await readGithubIssue(ref, "octo", gh.env);

    expect(issue).toMatchObject({ title: "T", state: "closed", labels: ["bug"] });
  });
});

describe("githubWriteAnswer", () => {
  it("answers the edit call of an issue with the arguments after -R", () => {
    const answer = githubWriteAnswer({
      project: "octo/repo",
      number: 7,
      verb: "edit",
      rest: ["--add-label", "done"],
    });

    expect(answer.args).toEqual(["issue", "edit", "7", "-R", "octo/repo", "--add-label", "done"]);
    expect(answer.exitCode).toBeUndefined();
  });

  it("gives the stderr and the exit code of a failed close call", () => {
    const answer = githubWriteAnswer({
      project: "octo/repo",
      number: 7,
      verb: "close",
      rest: ["--reason", "completed"],
      stderr: "boom\n",
      exitCode: 1,
    });

    expect(answer.args).toEqual(["issue", "close", "7", "-R", "octo/repo", "--reason", "completed"]);
    expect(answer.stderr).toBe("boom\n");
    expect(answer.exitCode).toBe(1);
  });
});

describe("trackerWriteCalls", () => {
  it("gives the arguments of the edit and close calls only, in order", () => {
    const dir = useTempDir("tasker-write-calls-");
    const gh = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "t"),
      githubIssueAnswer({ project: "octo/repo", number: 7 }),
      githubWriteAnswer({ project: "octo/repo", number: 7, verb: "edit", rest: ["--add-assignee", "@me"] }),
      githubWriteAnswer({ project: "octo/repo", number: 7, verb: "close", rest: ["--reason", "completed"] }),
    ]);
    const run = (...args: string[]) => spawnSync("gh", args, { env: gh.env, encoding: "utf8" });

    run("auth", "token", "--hostname", "github.com", "--user", "octo");
    run("issue", "edit", "7", "-R", "octo/repo", "--add-assignee", "@me");
    run("issue", "view", "7", "-R", "octo/repo", "--json", "number,title,body,url,labels,state");
    run("issue", "close", "7", "-R", "octo/repo", "--reason", "completed");

    expect(trackerWriteCalls(gh)).toEqual([
      ["issue", "edit", "7", "-R", "octo/repo", "--add-assignee", "@me"],
      ["issue", "close", "7", "-R", "octo/repo", "--reason", "completed"],
    ]);
  });

  it("gives an empty list when gh made no write", () => {
    const gh = fakeGh(useTempDir("tasker-write-calls-"), {}, []);

    expect(trackerWriteCalls(gh)).toEqual([]);
  });
});

describe("githubLabelsAfter", () => {
  const edit = (number: number, flag: string, label: string) =>
    githubWriteAnswer({ project: "octo/repo", number, verb: "edit", rest: [flag, label] });

  it("applies the logged add and remove calls to the start labels, in order", () => {
    const answers = [
      edit(7, "--add-label", "wip"),
      edit(7, "--add-label", "wip"),
      edit(7, "--remove-label", "bug"),
      edit(7, "--remove-label", "none"),
    ];
    const gh = fakeGh(useTempDir("tasker-labels-after-"), {}, answers);
    for (const answer of answers) spawnSync("gh", [...answer.args], { env: gh.env, encoding: "utf8" });

    expect(githubLabelsAfter(gh, { project: "octo/repo", number: 7, labels: ["bug", "docs"] })).toEqual([
      "docs",
      "wip",
    ]);
  });

  it("ignores a call for another issue number", () => {
    const answer = edit(8, "--add-label", "wip");
    const gh = fakeGh(useTempDir("tasker-labels-after-"), {}, [answer]);
    spawnSync("gh", [...answer.args], { env: gh.env, encoding: "utf8" });

    expect(githubLabelsAfter(gh, { project: "octo/repo", number: 7 })).toEqual([]);
  });
});

describe("githubBlockersAnswer", () => {
  const ref = { key: "octo/repo#7", repoKey: "octo/repo", shortRef: "issue-7" };

  it("answers the read of the blockers of the issue", async () => {
    const gh = fakeGh(useTempDir("tasker-blockers-answer-"), {}, [
      ghTokenAnswer("octo", "t"),
      githubBlockersAnswer({
        project: "octo/repo",
        number: 7,
        blockers: [
          { number: 3, state: "OPEN" },
          { number: 9, state: "CLOSED", project: "other/lib" },
        ],
      }),
    ]);

    await expect(readGithubBlockers(ref, "octo", gh.env)).resolves.toEqual([
      { key: "octo/repo#3", state: "open" },
      { key: "other/lib#9", state: "closed" },
    ]);
  });

  it("answers an empty list when the issue has no blockers", async () => {
    const gh = fakeGh(useTempDir("tasker-blockers-answer-"), {}, [
      ghTokenAnswer("octo", "t"),
      githubBlockersAnswer({ project: "octo/repo", number: 7 }),
    ]);

    await expect(readGithubBlockers(ref, "octo", gh.env)).resolves.toEqual([]);
  });
});

describe("blockerReadCalls", () => {
  it("gives the arguments of the graphql calls only, in order", () => {
    const gh = fakeGh(useTempDir("tasker-blocker-calls-"), {}, [
      ghTokenAnswer("octo", "t"),
      githubIssueAnswer({ project: "octo/repo", number: 7 }),
      githubBlockersAnswer({ project: "octo/repo", number: 7 }),
    ]);
    const run = (...args: string[]) => spawnSync("gh", args, { env: gh.env, encoding: "utf8" });
    const blockersArgs = githubBlockersAnswer({ project: "octo/repo", number: 7 }).args;

    run("issue", "view", "7", "-R", "octo/repo", "--json", "number,title,body,url,labels,state");
    run(...blockersArgs);

    expect(blockerReadCalls(gh)).toEqual([blockersArgs]);
  });

  it("gives an empty list when gh made no graphql call", () => {
    const gh = fakeGh(useTempDir("tasker-blocker-calls-"), {}, []);

    expect(blockerReadCalls(gh)).toEqual([]);
  });
});
