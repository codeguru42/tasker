import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { readGithubIssue } from "../src/issues/github/issue.js";
import { loadConfig } from "../src/config/load.js";
import { parseConfig } from "../src/config/schema.js";
import { bootstrapLogPath } from "../src/phases/bootstrap.js";
import { IssueKeyError } from "../src/issue-key/ref.js";
import { resolveIssueKey } from "../src/issue-key/resolve.js";
import { openStore } from "../src/store/store.js";
import { createDataRoot, taskLogsDir } from "../src/store/layout.js";
import { repoPaths } from "../src/vcs/git/repo-paths.js";
import { GitError, runGit } from "../src/vcs/git/run.js";
import {
  assertTaskBranchShape,
  createTaskWorktree,
  taskBranchName,
  taskWorktreePath,
} from "../src/vcs/git/worktree.js";
import {
  addCloneCommit,
  captureIo,
  commitInWorktree,
  dayAt,
  failureOf,
  fakeGh,
  fakeSsh,
  GIT_TEST_IDENTITY,
  greet,
  ghTokenAnswer,
  githubIssueAnswer,
  gitCloneTokens,
  gitTestEnv,
  isAlive,
  issueKeyErrorMessage,
  localBranches,
  lockNames,
  makeGitClone,
  makeGitOrigin,
  makeTempDir,
  readPidFile,
  runCommand,
  savePid,
  seedTasks,
  sshKeyArgs,
  taskNames,
  threeRepoConfig,
  useProcessEnv,
  useTempDir,
  useThreeRepoDataRoot,
  validConfig,
  waitUntil,
  waitUntilGone,
  writeBootstrapLog,
  writeDataRootConfig,
  writeFakeGh,
  type GitOrigin,
} from "./helpers.js";

describe("makeGitOrigin", () => {
  let origin: GitOrigin;

  beforeEach(async () => {
    origin = await makeGitOrigin();
  });

  afterEach(() => {
    origin.remove();
  });

  const git = (...args: string[]) =>
    runGit(args, { gitDir: origin.path, env: origin.env }).then((out) => out.trim());

  it("makes a bare origin with one commit on main", async () => {
    expect(await git("rev-parse", "--is-bare-repository")).toBe("true");
    expect(await git("symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(await git("rev-list", "--count", "main")).toBe("1");
  });

  it("adds a commit and returns the new head", async () => {
    const sha = await origin.addCommit("main");
    expect(await origin.branchHead("main")).toBe(sha);
    expect(await git("rev-list", "--count", "main")).toBe("2");
  });

  it("creates a branch at the head of main", async () => {
    await origin.createBranch("feature");
    expect(await origin.branchHead("feature")).toBe(await origin.branchHead("main"));
  });

  it("moves only the branch that gets the commit", async () => {
    await origin.createBranch("feature");
    const mainHead = await origin.branchHead("main");
    await origin.addCommit("feature", { file: "a.txt", content: "x" });
    expect(await origin.branchHead("main")).toBe(mainHead);
    expect(await origin.branchHead("feature")).not.toBe(mainHead);
    expect(await git("show", "feature:a.txt")).toBe("x");
  });

  it("returns undefined for a missing branch", async () => {
    expect(await origin.branchHead("missing")).toBeUndefined();
  });

  it("does not take a branch for the prefix of another branch", async () => {
    await origin.createBranch("a/b");
    expect(await origin.branchHead("a/b")).toBeDefined();
    expect(await origin.branchHead("a")).toBeUndefined();
  });

  it("rejects a commit on a missing branch with a GitError", async () => {
    await expect(origin.addCommit("missing")).rejects.toBeInstanceOf(GitError);
  });

  it("uses the fixed test identity", async () => {
    expect(await git("log", "-1", "--format=%an <%ae>", "main")).toBe(
      `${GIT_TEST_IDENTITY.name} <${GIT_TEST_IDENTITY.email}>`,
    );
  });

  it("reads no git configuration of the host", () => {
    expect(origin.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(origin.env.GIT_CONFIG_NOSYSTEM).toBe("1");
  });

  it("removes its folder", () => {
    expect(existsSync(origin.dir)).toBe(true);
    origin.remove();
    expect(existsSync(origin.dir)).toBe(false);
  });

  it("commits a file in a nested folder", async () => {
    await origin.addCommit("main", { file: "dir/sub/a.txt", content: "y" });
    expect(await git("show", "main:dir/sub/a.txt")).toBe("y");
  });

  it("adds one commit for each call, also with the same file and content", async () => {
    const first = await origin.addCommit("main", { file: "same.txt", content: "z" });
    const second = await origin.addCommit("main", { file: "same.txt", content: "z" });
    expect(second).not.toBe(first);
    expect(await git("rev-list", "--count", "main")).toBe("3");
  });

  it.each(["/tmp/x", "../x", "a/../../x", ".git/config"])(
    "rejects the file %s and leaves main as it was",
    async (file) => {
      const before = await origin.branchHead("main");
      await expect(origin.addCommit("main", { file })).rejects.toThrow(
        "addCommit needs a file inside the work repo",
      );
      expect(await origin.branchHead("main")).toBe(before);
    },
  );

  it("rejects a branch name that starts with -", async () => {
    await expect(origin.createBranch("-d")).rejects.toThrow(
      "the branch name must not start with -",
    );
    await expect(origin.addCommit("-x")).rejects.toThrow("the branch name must not start with -");
  });
});

describe("taskNames", () => {
  it("gives the branch and the worktree of a GitHub issue number", () => {
    expect(taskNames("/w", 16)).toStrictEqual({
      branch: taskBranchName("issue-16", "x"),
      worktree: taskWorktreePath("/w", "issue-16"),
    });
  });

  it("uses the title for the branch", () => {
    expect(taskNames("/w", 5, "Add tasker show").branch).toBe(
      taskBranchName("issue-5", "Add tasker show"),
    );
  });

  it("gives a branch with the shape of a task branch", () => {
    expect(() => assertTaskBranchShape(taskNames("/w", 1).branch)).not.toThrow();
  });
});

describe("makeGitClone", () => {
  let origin: GitOrigin;

  beforeEach(async () => {
    origin = await makeGitOrigin();
  });

  afterEach(() => {
    origin.remove();
  });

  it("makes a bare clone inside the origin folder with the remote branches fetched", async () => {
    const clone = await makeGitClone(origin);
    const git = (...args: string[]) =>
      runGit(args, { gitDir: clone, env: origin.env }).then((out) => out.trim());

    expect(clone.startsWith(`${origin.dir}${sep}`)).toBe(true);
    expect(await git("rev-parse", "--is-bare-repository")).toBe("true");
    expect(await git("rev-parse", "refs/remotes/origin/main")).toBe(
      await origin.branchHead("main"),
    );
  });

  it("puts the clone at the repo folder of tasker under the clone-data data root", async () => {
    const clone = await makeGitClone(origin);
    expect(clone).toBe(repoPaths(join(origin.dir, "clone-data"), "tasker").clone);
  });

  it("gives the publish tokens of that repo folder", async () => {
    await makeGitClone(origin);
    const { publishTokens } = repoPaths(join(origin.dir, "clone-data"), "tasker");
    expect(gitCloneTokens(origin)).toBe(publishTokens);
    expect(existsSync(dirname(publishTokens))).toBe(true);
  });
});

describe("addCloneCommit", () => {
  let origin: GitOrigin;
  let clone: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    clone = await makeGitClone(origin);
  });

  afterEach(() => {
    origin.remove();
  });

  const git = (...args: string[]) =>
    runGit(args, { gitDir: clone, env: origin.env }).then((out) => out.trim());

  it("makes a new branch with origin main as the parent", async () => {
    const sha = await addCloneCommit(clone, origin.env, "b1");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await git("rev-parse", "refs/heads/b1")).toBe(sha);
    expect(await git("rev-parse", `${sha}^`)).toBe(await git("rev-parse", "refs/remotes/origin/main"));
  });

  it("makes only the branch that it names, and localBranches() lists it", async () => {
    await addCloneCommit(clone, origin.env, "b1");
    expect(await localBranches(clone, origin.env)).toEqual(["refs/heads/b1"]);
  });

  it("makes a child of the tip of an existing branch", async () => {
    const first = await addCloneCommit(clone, origin.env, "b1");
    const second = await addCloneCommit(clone, origin.env, "b1");
    expect(second).not.toBe(first);
    expect(await git("rev-parse", `${second}^`)).toBe(first);
    expect(await git("rev-parse", "refs/heads/b1")).toBe(second);
  });

  it("moves an existing branch to a commit on the given parent", async () => {
    const first = await addCloneCommit(clone, origin.env, "b1");
    const moved = await addCloneCommit(clone, origin.env, "b1", "refs/remotes/origin/main");
    expect(moved).not.toBe(first);
    expect(await git("rev-parse", "refs/heads/b1")).toBe(moved);
    expect(await git("rev-parse", `${moved}^`)).toBe(await git("rev-parse", "refs/remotes/origin/main"));
  });

  it("refuses a branch or a parent that starts with a dash", async () => {
    await failureOf(addCloneCommit(clone, origin.env, "-x"), Error);
    await failureOf(addCloneCommit(clone, origin.env, "b1", "-x"), Error);
  });

  it("names the value that starts with a dash in the error", async () => {
    const branchError = await failureOf(
      addCloneCommit(clone, origin.env, "-x", "refs/remotes/origin/main"),
      Error,
    );
    expect(branchError.message).toContain('"-x"');
    const parentError = await failureOf(addCloneCommit(clone, origin.env, taskBranchName("issue-1", "x"), "-p"), Error);
    expect(parentError.message).toContain('"-p"');
  });
});

describe("commitInWorktree", () => {
  let origin: GitOrigin;
  let worktree: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    const clone = await makeGitClone(origin);
    const names = taskNames(join(origin.dir, "worktrees"), 15);
    worktree = names.worktree;
    await createTaskWorktree({
      clone,
      env: origin.env,
      path: worktree,
      branch: names.branch,
      baseRevision: "refs/remotes/origin/main",
    });
  });

  afterEach(() => {
    origin.remove();
  });

  const git = (...args: string[]) =>
    runGit(args, { cwd: worktree, env: origin.env }).then((out) => out.trim());

  it("commits the file and returns the new head", async () => {
    const sha = await commitInWorktree(worktree, origin.env, { file: "a/b.txt", content: "x" });
    expect(await git("rev-parse", "HEAD")).toBe(sha);
    expect(await git("show", "HEAD:a/b.txt")).toBe("x");
  });

  it("throws for a file outside the worktree", async () => {
    await expect(
      commitInWorktree(worktree, origin.env, { file: "../x" }),
    ).rejects.toThrow("commitInWorktree needs a file inside the worktree: ../x");
  });
});

describe("failureOf", () => {
  it("gives the error of a rejected promise", async () => {
    const error = new GitError("m", "x", "", "", 1);
    expect(await failureOf(Promise.reject(error), GitError)).toBe(error);
  });

  it("rejects when the promise resolves", async () => {
    await expect(failureOf(Promise.resolve(1), Error)).rejects.toThrow("resolved");
  });

  it("rejects when the error has another type", async () => {
    await expect(failureOf(Promise.reject(new Error("m")), GitError)).rejects.toThrow("not a");
  });
});

describe("fakeSsh", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir("tasker-fake-ssh-");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("puts the bin folder first on the PATH", () => {
    const ssh = fakeSsh(dir, gitTestEnv(dir), "serve");
    expect(ssh.env.PATH?.startsWith(join(dir, "bin") + delimiter)).toBe(true);
  });

  it("gives the ssh remote of a repo path", () => {
    const ssh = fakeSsh(dir, gitTestEnv(dir), "serve");
    expect(ssh.remote("/x/o.git")).toBe("ssh://tasker.invalid/x/o.git");
  });

  it("writes the fake ssh into the bin folder", () => {
    fakeSsh(dir, gitTestEnv(dir), "refuse");
    expect(existsSync(join(dir, "bin", "ssh"))).toBe(true);
  });
});

describe("fakeGh", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir("tasker-fake-gh-");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (env: NodeJS.ProcessEnv, ...args: string[]) =>
    spawnSync("gh", args, { env, encoding: "utf8" });

  it("answers a listed call with the stdout, stderr and exit code of its answer", () => {
    const gh = fakeGh(dir, {}, [
      { args: ["issue", "view", "7"], stdout: "out\n", stderr: "err\n", exitCode: 3 },
    ]);
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
    expect(() => fakeGh(dir, {}, [{ args: ["slow"], delaySeconds: -1 }])).toThrow(
      "bad delay for the fake gh: -1",
    );
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
    expect(() =>
      writeFakeGh(join(dir, "bin"), join(dir, "gh.log"), [{ args: [], killWith: "TERM; rm" }]),
    ).toThrow();
  });
});

describe("sshKeyArgs", () => {
  it("gives the six ssh arguments of a key", () => {
    expect(sshKeyArgs("/k")).toEqual([
      "-i",
      "/k",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
    ]);
  });
});

describe("writeDataRootConfig", () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes config.json with dataRoot set to the data folder of the dir", () => {
    const raw = validConfig();
    const written = writeDataRootConfig(raw);
    dir = written.dir;

    expect(written.path).toBe(join(dir, "config.json"));
    expect(written.dataRoot).toBe(join(dir, "data"));
    expect(JSON.parse(readFileSync(written.path, "utf8"))).toEqual({
      ...validConfig(),
      dataRoot: join(dir, "data"),
    });
  });

  it("does not change its input", () => {
    const raw = validConfig();
    dir = writeDataRootConfig(raw).dir;

    expect(raw).toEqual(validConfig());
  });
});

describe("seedTasks", () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the tasks in input order with their times", () => {
    dir = makeTempDir("tasker-seed-");
    const dataRoot = join(dir, "data");

    const tasks = seedTasks(dataRoot, [
      { issueKey: "a/b#2", repoKey: "a/b", state: "planning", at: "2026-01-02T00:00:00.000Z" },
      { issueKey: "a/b#1", repoKey: "a/c", state: "finished", at: "2026-01-01T00:00:00.000Z" },
    ]);

    expect(tasks.map((t) => [t.issueKey, t.repoKey, t.state])).toEqual([
      ["a/b#2", "a/b", "planning"],
      ["a/b#1", "a/c", "finished"],
    ]);
    expect(tasks.map((t) => [t.createdAt, t.updatedAt])).toEqual([
      ["2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z"],
      ["2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    ]);
    const store = openStore(createDataRoot(dataRoot).database);
    try {
      expect(store.listTasks({ states: ["planning", "finished"] }).map((t) => t.id)).toEqual(
        tasks.map((t) => t.id),
      );
    } finally {
      store.close();
    }
  });
});

describe("threeRepoConfig", () => {
  it("passes parseConfig with the repos tasker, other and fork", () => {
    const config = parseConfig(threeRepoConfig(), {}, "/home/me");

    expect(Object.keys(config.repos).sort()).toEqual(["codeguru42/other", "codeguru42/tasker", "fork"]);
    expect(config.repos.fork.issueTracker.project).toBe("codeguru42/tasker");
  });
});

describe("seedTasks with more fields", () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores the title, base, branch and worktreePath when given", () => {
    dir = makeTempDir("tasker-seed-");
    const names = taskNames("/tmp/wt", 1, "A title");

    const [task] = seedTasks(join(dir, "data"), [
      {
        issueKey: "a/b#1",
        repoKey: "a/b",
        state: "workspace_ready",
        at: "2026-01-02T00:00:00.000Z",
        title: "A title",
        base: "main",
        branch: names.branch,
        worktreePath: names.worktree,
      },
    ]);

    expect(task).toMatchObject({
      title: "A title",
      base: "main",
      branch: names.branch,
      worktreePath: names.worktree,
    });
  });

  it("fails the task at its time with failWith", () => {
    dir = makeTempDir("tasker-seed-");
    const dataRoot = join(dir, "data");
    const at = "2026-01-04T00:00:00.000Z";

    const [task] = seedTasks(dataRoot, [
      { issueKey: "a/b#1", repoKey: "a/b", state: "executing", at, failWith: "git push failed" },
    ]);

    expect(task.state).toBe("failed");
    expect(task.updatedAt).toBe(at);
    const store = openStore(createDataRoot(dataRoot).database);
    try {
      const last = store.listEvents(task.id).at(-1);
      expect(last).toMatchObject({
        at,
        type: "transition",
        data: { error: "git push failed", from: "executing", to: "failed" },
      });
    } finally {
      store.close();
    }
  });
});

describe("dayAt", () => {
  it("gives 00:00 UTC of a day in January 2026", () => {
    expect(dayAt(2)).toBe("2026-01-02T00:00:00.000Z");
    expect(dayAt(12)).toBe("2026-01-12T00:00:00.000Z");
  });
});

describe("useThreeRepoDataRoot", () => {
  it("points TASKER_CONFIG at the written configuration", () => {
    const written = useThreeRepoDataRoot();

    expect(process.env.TASKER_CONFIG).toBe(written.path);
    expect(written.dataRoot).toBe(join(written.dir, "data"));
    expect(JSON.parse(readFileSync(written.path, "utf8"))).toEqual({
      ...threeRepoConfig(),
      dataRoot: written.dataRoot,
    });
  });

  it("removes the folder and the env stub after the test", () => {
    // onTestFinished callbacks run in reverse order, so this check runs after the cleanup of the helper.
    const holder: { written?: ReturnType<typeof useThreeRepoDataRoot> } = {};
    onTestFinished(() => {
      const { written } = holder;
      expect(written).toBeDefined();
      if (!written) return;
      expect(existsSync(written.dir)).toBe(false);
      expect(process.env.TASKER_CONFIG).not.toBe(written.path);
    });

    const written = useThreeRepoDataRoot();
    holder.written = written;

    expect(existsSync(written.dir)).toBe(true);
  });
});

describe("runCommand", () => {
  it("gives the help text and code 0 for --help", async () => {
    const result = await runCommand(greet, "greet", "--help");

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toContain("Say hello");
    expect(result.out).toContain("Who to greet");
  });

  it("gives code 1 and an error on stderr for an unknown option", async () => {
    const result = await runCommand(greet, "greet", "--bogus");

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("--bogus");
  });
});

describe("issueKeyErrorMessage", () => {
  it("gives the message of the error that resolveIssueKey throws", () => {
    const { path } = useThreeRepoDataRoot();
    let expected = "";
    try {
      resolveIssueKey("nobody/else#1", loadConfig({ TASKER_CONFIG: path }));
    } catch (error) {
      if (!(error instanceof IssueKeyError)) throw error;
      expected = error.message;
    }

    expect(expected).not.toBe("");
    expect(issueKeyErrorMessage("nobody/else#1", path)).toBe(expected);
  });

  it("fails the test for a key that resolves", () => {
    const { path } = useThreeRepoDataRoot();

    expect(() => issueKeyErrorMessage("codeguru42/other#1", path)).toThrow();
  });
});

describe("useTempDir", () => {
  let saved = "";

  it("makes a folder that exists", () => {
    saved = useTempDir("tasker-use-temp-");

    expect(saved).not.toBe("");
    expect(existsSync(saved)).toBe(true);
  });

  it("removes the folder after the test", () => {
    expect(saved).not.toBe("");
    expect(existsSync(saved)).toBe(false);
  });
});

describe("isAlive", () => {
  it("is true for the running test process", () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it("is false for a process that finished", () => {
    const finished = spawnSync("true");

    expect(finished.pid).toBeGreaterThan(0);
    expect(isAlive(finished.pid)).toBe(false);
  });
});

describe("waitUntil", () => {
  it("resolves when the predicate becomes true", async () => {
    let flag = false;
    setTimeout(() => {
      flag = true;
    }, 100);

    await expect(waitUntil(() => flag, 5000, "never")).resolves.toBeUndefined();
  });

  it("rejects with the message when the predicate stays false", async () => {
    await expect(waitUntil(() => false, 150, "the flag stayed false")).rejects.toThrow("the flag stayed false");
  });
});

describe("waitUntilGone", () => {
  it("resolves when the process ends", async () => {
    const child = spawn("sleep", ["0.2"], { stdio: "ignore" });
    savePid(child.pid!);

    await expect(waitUntilGone(child.pid!, 5000)).resolves.toBeUndefined();
  });

  it("rejects with the pid when the process stays", async () => {
    await expect(waitUntilGone(process.pid, 100)).rejects.toThrow(String(process.pid));
  });
});

describe("savePid", () => {
  let pid = 0;

  it("saves a pid that the test started", () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    expect(child.pid).toBeDefined();
    pid = child.pid!;
    savePid(pid);

    expect(isAlive(pid)).toBe(true);
  });

  it("kills the saved pid after the test", async () => {
    expect(pid).toBeGreaterThan(0);

    await expect(waitUntilGone(pid, 2000)).resolves.toBeUndefined();
  });
});

describe("readPidFile", () => {
  it("waits for the pid, returns it and saves it", async () => {
    const path = join(useTempDir("tasker-pid-file-"), "pid");
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    savePid(child.pid!);
    setTimeout(() => writeFileSync(path, `${child.pid}\n`), 100);

    await expect(readPidFile(path, 5000)).resolves.toBe(child.pid);
    expect(isAlive(child.pid!)).toBe(true);
  });

  it("rejects when no file appears", async () => {
    const path = join(useTempDir("tasker-pid-file-"), "pid");

    await expect(readPidFile(path, 150)).rejects.toThrow();
  });
});

describe("writeBootstrapLog", () => {
  it("writes the text to the bootstrap log in the logs folder of the attempt of the task", () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [
      { issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state: "workspace_ready", at: dayAt(2) },
    ]);

    writeBootstrapLog(dataRoot, task, "=== bootstrap run ===\n");

    const expected = bootstrapLogPath(taskLogsDir(dataRoot, task));
    expect(readFileSync(expected, "utf8")).toBe("=== bootstrap run ===\n");
  });
});

describe("useProcessEnv", () => {
  it("sets a name", () => {
    useProcessEnv({ TASKER_HELPER_PROBE: "x" });

    expect(process.env.TASKER_HELPER_PROBE).toBe("x");
  });

  it("removes a name when the value is undefined", () => {
    useProcessEnv({ TASKER_HELPER_PROBE: "x" });
    useProcessEnv({ TASKER_HELPER_PROBE: undefined });

    expect(process.env.TASKER_HELPER_PROBE).toBeUndefined();
  });

  it("restores process.env after the test", () => {
    expect(process.env.TASKER_HELPER_PROBE).toBeUndefined();
  });
});

describe("captureIo", () => {
  it("has no prompt with no options", () => {
    expect(captureIo().prompt).toBeUndefined();
  });

  it("answers each question in turn and records it", async () => {
    const io = captureIo({ answers: ["a", "b"] });
    await expect(io.prompt?.("first? ")).resolves.toBe("a");
    await expect(io.prompt?.("second? ")).resolves.toBe("b");
    expect(io.questions).toEqual(["first? ", "second? "]);
  });

  it("rejects when no answer is left", async () => {
    const io = captureIo({ answers: [] });
    await expect(io.prompt?.("more? ")).rejects.toThrow();
    expect(io.questions).toEqual(["more? "]);
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

describe("lockNames", () => {
  it("gives the sorted names of the lock rows, and none after unlock", () => {
    const dataRoot = useTempDir("tasker-lock-names-");
    const store = openStore(createDataRoot(dataRoot).database);
    try {
      store.tryLock("repo:b");
      store.tryLock("repo:a");
      expect(lockNames(dataRoot)).toEqual(["repo:a", "repo:b"]);

      store.unlock("repo:a");
      store.unlock("repo:b");
      expect(lockNames(dataRoot)).toEqual([]);
    } finally {
      store.close();
    }
  });
});
