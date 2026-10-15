import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readGithubIssue } from "../src/issues/github/issue.js";
import { issueProviderFor } from "../src/issues/provider.js";
import { checkPlanAnswer } from "../src/plan/answer.js";
import { childEnv } from "../src/process/child-env.js";
import { type Task, type TaskStore } from "../src/store/store.js";
import { dataRootLayout, planRevisionPath } from "../src/store/layout.js";
import { changedPaths } from "../src/vcs/git/changes.js";
import { repoPaths } from "../src/vcs/git/repo-paths.js";
import {
  claudeOverageEvent,
  claudeRateLimitEvent,
  claudeSample,
  claudeSampleEvents,
  claudeSampleWithResult,
  dayAt,
  fakeGh,
  ghTokenAnswer,
  githubIssueAnswer,
  isAlive,
  localBranches,
  readRunMarker,
  runInput,
  savePid,
  recordPlanRevisions,
  recordTestPlanRevision,
  seedPlanRevision,
  seedExecuteSession,
  seedExecuteTodoStates,
  seedPlanSession,
  seedPlanningTask,
  seedTaskWithPlanFiles,
  startIssueTask,
  startTaskWithCommits,
  TEST_EXECUTE_SESSION_ID,
  TEST_SESSION_ID,
  taskWorkspaceState,
  useFakeClaude,
  useTempDir,
  useAssistantRunFixture,
  useStartedTask,
  useStartFixture,
  validPlanAnswer,
  waitUntil,
  withDataRootStore,
  writeFakeGh,
  writePlaceholder,
  planAnswerStream,
  usePlanFixture,
} from "./helpers.js";

// Creates the task a/b#1 in the planning state, the task that the store tests of the helpers use.
function seedTask(store: TaskStore): Task {
  return store.createTask({ issueKey: "a/b#1", repoKey: "a/b", state: "planning" });
}

describe("fakeGh", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-fake-gh-");
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
    expect(() =>
      writeFakeGh(join(dir, "bin"), join(dir, "gh.log"), [{ args: [], killWith: "TERM; rm" }]),
    ).toThrow();
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

describe("useStartFixture", () => {
  it("gives a configuration with the origin as the remote and main as the base", async () => {
    const fixture = await useStartFixture();
    const repo = fixture.config.repos[fixture.repoKey];

    expect(fixture.repoKey).toBe("codeguru42/tasker");
    expect(repo.remote).toBe(fixture.origin.path);
    expect(repo.defaultBaseBranch).toBe("main");
  });

  it("sets TASKER_CONFIG and puts the fake gh first on the PATH", async () => {
    const fixture = await useStartFixture();

    expect(process.env.TASKER_CONFIG).toBe(fixture.configPath);
    expect(process.env.PATH?.startsWith(`${fixture.gh.env.PATH}${delimiter}`)).toBe(true);
  });

  it("answers the read of issue 5 through the fake gh", async () => {
    const fixture = await useStartFixture();
    const provider = issueProviderFor(fixture.config, fixture.repoKey);
    const ref = { key: "codeguru42/tasker#5", repoKey: fixture.repoKey, shortRef: "codeguru42-tasker-5" };

    const issue = await provider.fetchIssue(ref, process.env);

    expect(issue.title).toBe("Issue 5");
  });

  it("removes a repo key that is set to undefined", async () => {
    const fixture = await useStartFixture({ repo: { defaultBaseBranch: undefined } });

    expect(fixture.config.repos[fixture.repoKey].defaultBaseBranch).toBeUndefined();
  });
});

describe("useAssistantRunFixture", () => {
  it("moves the task into the state, with a run marker of this process", async () => {
    const fixture = await useAssistantRunFixture({ claude: {}, state: "executing" });

    expect(fixture.task.state).toBe("executing");
    expect(readRunMarker(dataRootLayout(fixture.config.dataRoot).database, fixture.task.id)).toMatchObject({
      state: "executing",
      pid: process.pid,
    });
  });

  it("starts in the planning state and changes the limits of a copy of the configuration", async () => {
    const fixture = await useAssistantRunFixture({ claude: {}, limits: { planTimeoutMin: 7 } });

    expect(fixture.task.state).toBe("planning");
    expect(fixture.config.limits.planTimeoutMin).toBe(7);
    expect(fixture.started.config.limits.planTimeoutMin).not.toBe(7);
  });

  it("sets the ssh keys and adds a second repo after the task repo in the copy only", async () => {
    const fixture = await useAssistantRunFixture({
      claude: {},
      sshKey: "/keys/a_key",
      otherRepo: { key: "codeguru42/other", sshKey: "/keys/b_key" },
    });

    const { repoKey } = fixture.started;
    expect(Object.keys(fixture.config.repos)).toEqual([repoKey, "codeguru42/other"]);
    expect(fixture.config.repos[repoKey]!.vcs).toEqual({ provider: "git", config: { sshKey: "/keys/a_key" } });
    expect(fixture.config.repos["codeguru42/other"]!.vcs).toEqual({
      provider: "git",
      config: { sshKey: "/keys/b_key" },
    });
    expect(Object.keys(fixture.started.config.repos)).toEqual([repoKey]);
    expect(fixture.started.config.repos[repoKey]!.vcs).toEqual({ provider: "git", config: {} });
  });

  it("gives an env with the fake claude first and the secrets that the child must not get", async () => {
    const fixture = await useAssistantRunFixture({ claude: {} });

    expect(fixture.env.PATH?.split(delimiter)[0]).toBe(fixture.claude.binDir);
    expect(fixture.env.GH_TOKEN).toBe("gho_secret");
    expect(fixture.env.SSH_AUTH_SOCK).toBe("/tmp/agent.sock");
    expect(fixture.env.HOME).not.toBe(fixture.started.env.HOME);
  });
});

describe("useStartedTask", () => {
  it("starts the task of issue 5 and gives its names", async () => {
    const started = await useStartedTask();

    expect(started.result.code).toBe(0);
    expect(started.key).toBe("codeguru42/tasker#5");
    expect(existsSync(started.worktree)).toBe(true);
    expect(await localBranches(started.clone, started.env)).toContain(`refs/heads/${started.branch}`);
  });
});

describe("startIssueTask", () => {
  it("starts the task of the issue number and gives its names", async () => {
    const fixture = await useStartFixture({ issues: [{ project: "codeguru42/tasker", number: 6 }] });
    const started = await startIssueTask(fixture, 6);

    expect(started.result.code).toBe(0);
    expect(started.key).toBe("codeguru42/tasker#6");
    expect(existsSync(started.worktree)).toBe(true);
    expect(await localBranches(started.clone, fixture.origin.env)).toContain(`refs/heads/${started.branch}`);
  });
});

describe("startTaskWithCommits", () => {
  it("starts the task and commits each file on its branch", async () => {
    const fixture = await useStartFixture({ issues: [{ project: "codeguru42/tasker", number: 6 }] });

    const task = await startTaskWithCommits(fixture, 6, ["src/a.ts", "docs/b.md"]);

    expect(task.state).toBe("workspace_ready");
    expect(task.issueKey).toBe("codeguru42/tasker#6");
    const paths = await changedPaths({
      clone: repoPaths(fixture.dataRoot, fixture.repoKey).clone,
      env: fixture.origin.env,
      branch: task.branch!,
      baseRevision: "refs/remotes/origin/main",
    });
    expect([...paths].sort()).toEqual(["docs/b.md", "src/a.ts"]);
  });
});

describe("seedTaskWithPlanFiles", () => {
  const seed = { issueKey: "codeguru42/tasker#7", repoKey: "codeguru42/tasker", at: dayAt(3) };

  it("gives the files as the files_changed of revision v1 and keeps the state", () => {
    const dataRoot = useTempDir("tasker-seed-");

    const task = seedTaskWithPlanFiles(dataRoot, { ...seed, state: "awaiting_plan_review" }, ["src/a.ts"]);

    withDataRootStore(dataRoot, (store) => {
      expect(store.latestPlanRevision(task.id)?.answer.files_changed).toEqual(["src/a.ts"]);
      expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
    });
  });

  it("keeps the state finished", () => {
    const dataRoot = useTempDir("tasker-seed-");

    const task = seedTaskWithPlanFiles(dataRoot, { ...seed, state: "finished" }, ["src/a.ts"]);

    withDataRootStore(dataRoot, (store) => {
      expect(store.latestPlanRevision(task.id)?.answer.files_changed).toEqual(["src/a.ts"]);
      expect(store.getTask(task.id)?.state).toBe("finished");
    });
  });
});

describe("taskWorkspaceState", () => {
  it("gives the state of a started task", async () => {
    const started = await useStartedTask();

    expect(await taskWorkspaceState(started)).toEqual({
      state: "workspace_ready",
      worktree: true,
      listed: true,
      branch: true,
    });
  });

  it("shows a folder that is gone, while git still lists the worktree", async () => {
    const started = await useStartedTask();
    rmSync(started.worktree, { recursive: true, force: true });

    expect(await taskWorkspaceState(started)).toEqual({
      state: "workspace_ready",
      worktree: false,
      listed: true,
      branch: true,
    });
  });
});

// Runs the fake claude with the env of the caller and the given stdin.
function runClaude(env: NodeJS.ProcessEnv, args: string[], input = "") {
  return spawnSync("claude", args, { env, input, encoding: "utf8" });
}

// Starts the fake claude with the async spawn and ends stdin. It saves the pid. stdout() gives the text so far,
// and exited gives the signal that ended the child.
function startClaude(env: NodeJS.ProcessEnv) {
  const child = spawn("claude", [], { env, stdio: ["pipe", "pipe", "ignore"] });
  const pid = child.pid!;
  savePid(pid);
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out += chunk;
  });
  child.stdin.end();
  const exited = new Promise<NodeJS.Signals | null>((resolve) => child.on("exit", (_code, signal) => resolve(signal)));
  return { pid, stdout: () => out, exited };
}

describe("claudeSample", () => {
  it("gives the lines of a recorded stream, with no empty last item", () => {
    const lines = claudeSample("plain");

    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: "system", subtype: "init" });
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ type: "result" });
  });
});

describe("runInput", () => {
  it("gives the defaults, with the shared session id", () => {
    expect(runInput()).toEqual({
      sessionId: TEST_SESSION_ID,
      resume: false,
      prompt: "say hello",
      cwd: "/work",
      env: {},
      timeoutMs: 20_000,
      sessionDir: "/sessions",
      model: "haiku",
      effort: "low",
    });
  });

  it("lets an override win and keeps the other defaults", () => {
    const input = runInput({ resume: true, model: "opus" });

    expect(input).toMatchObject({ resume: true, model: "opus", effort: "low", prompt: "say hello" });
  });

  it("gives a new object for each call", () => {
    const first = runInput();
    first.prompt = "changed";
    (first.env as Record<string, string>)["X"] = "1";

    expect(runInput().prompt).toBe("say hello");
    expect(runInput().env).toEqual({});
  });
});

describe("claudeSampleEvents", () => {
  it("gives each line of a sample as a parsed event", () => {
    const events = claudeSampleEvents("plain");

    expect(events).toHaveLength(4);
    expect(events).toEqual(claudeSample("plain").map((line) => JSON.parse(line)));
  });

  it("gives new objects for each call", () => {
    claudeSampleEvents("plain")[0]!["type"] = "changed";

    expect(claudeSampleEvents("plain")[0]!["type"]).toBe("system");
  });
});

describe("claudeSampleWithResult", () => {
  it("gives the events with the last one edited", () => {
    const events = claudeSampleWithResult("plain", (result) => {
      result["is_error"] = true;
    });

    expect(events).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({ type: "result", is_error: true });
    expect(events.slice(0, -1)).toEqual(claudeSampleEvents("plain").slice(0, -1));
  });

  it("does not change the sample file or a later read", () => {
    const lines = claudeSample("plain");
    const events = claudeSampleEvents("plain");

    claudeSampleWithResult("plain", (result) => {
      result["is_error"] = true;
      delete result["usage"];
    });

    expect(claudeSample("plain")).toEqual(lines);
    expect(claudeSampleEvents("plain")).toEqual(events);
  });
});

describe("claudeRateLimitEvent", () => {
  it("gives the parsed capture when it has no edit", () => {
    expect(claudeRateLimitEvent()).toEqual(JSON.parse(claudeSample("rate-limit-warning")[0]!));
  });

  it("applies the edit to rate_limit_info", () => {
    const event = claudeRateLimitEvent((info) => {
      info["utilization"] = 0.5;
    });

    expect(event["rate_limit_info"]).toMatchObject({ utilization: 0.5, rateLimitType: "seven_day" });
  });

  it("gives a new object for each call, so an edit does not leak", () => {
    claudeRateLimitEvent((info) => {
      info["utilization"] = 0.5;
    });

    expect(claudeRateLimitEvent()["rate_limit_info"]).toMatchObject({ utilization: 0.8 });
  });
});

describe("claudeOverageEvent", () => {
  it("gives the capture with isUsingOverage true and no other change", () => {
    const expected = claudeRateLimitEvent((info) => {
      info["isUsingOverage"] = true;
    });

    expect(claudeOverageEvent()).toEqual(expected);
  });

  it("runs the edit after the change", () => {
    const event = claudeOverageEvent((info) => {
      info["rateLimitType"] = "overage";
    });

    expect(event["rate_limit_info"]).toMatchObject({ isUsingOverage: true, rateLimitType: "overage" });
  });

  it("gives a new object for each call, so an edit does not leak", () => {
    claudeOverageEvent((info) => {
      info["utilization"] = 0.5;
    });

    expect(claudeOverageEvent()["rate_limit_info"]).toMatchObject({ utilization: 0.8 });
  });
});

describe("useFakeClaude controls untilStopped and sigtermStream", () => {
  it("keeps running after the output until a signal stops it", { timeout: 15_000 }, async () => {
    const fake = useFakeClaude({ stream: ["one"], untilStopped: true });
    const child = startClaude(fake.env);

    await waitUntil(() => child.stdout().includes("one\n"), 10_000, "the fake wrote no line");
    expect(isAlive(child.pid)).toBe(true);
    process.kill(child.pid, "SIGTERM");

    expect(await child.exited).toBe("SIGTERM");
  });

  it("writes its lines on SIGTERM and does not exit", { timeout: 15_000 }, async () => {
    const fake = useFakeClaude({ stream: ["one"], sigtermStream: ["two"], untilStopped: true });
    const child = startClaude(fake.env);

    await waitUntil(() => child.stdout().includes("one\n"), 10_000, "the fake wrote no line");
    process.kill(child.pid, "SIGTERM");
    await waitUntil(() => child.stdout().includes("two\n"), 10_000, "the fake wrote no sigtermStream line");
    expect(isAlive(child.pid)).toBe(true);
    process.kill(child.pid, "SIGKILL");

    expect(await child.exited).toBe("SIGKILL");
  });
});

describe("useFakeClaude", () => {
  it("plays back a sample on stdout and logs argv, stdin and env names", () => {
    const stream = claudeSample("plain");
    const fake = useFakeClaude({ stream });

    const result = runClaude(fake.env, ["-p", "--model", "opus"], "say hello");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${stream.join("\n")}\n`);
    const calls = fake.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.argv).toEqual(["-p", "--model", "opus"]);
    expect(calls[0]!.stdin).toBe("say hello");
    expect(calls[0]!.envNames).toEqual(expect.arrayContaining(["HOME", "PATH"]));
  });

  it("gives [] before the fake runs, and one call for each run", () => {
    const fake = useFakeClaude({});
    expect(fake.calls()).toEqual([]);

    runClaude(fake.env, ["a"]);
    runClaude(fake.env, ["b"]);

    expect(fake.calls().map((call) => call.argv)).toEqual([["a"], ["b"]]);
  });

  it("writes stderr and exits with the exit code", () => {
    const fake = useFakeClaude({ stderr: "bad\n", exitCode: 3 });

    const result = runClaude(fake.env, ["-p"]);

    expect(result.status).toBe(3);
    expect(result.stderr).toBe("bad\n");
    expect(fake.calls()).toHaveLength(1);
  });

  it("answers --version from the version control, and not a run", () => {
    const fake = useFakeClaude({
      stream: claudeSample("plain"),
      version: { stdout: "2.1.299 (Claude Code)\n", exitCode: 0 },
    });

    const result = runClaude(fake.env, ["--version"]);

    expect(result.stdout).toBe("2.1.299 (Claude Code)\n");
    expect(result.status).toBe(0);
  });

  it("ends with the signal of killWith after the output", () => {
    const fake = useFakeClaude({ stream: ["{}"], killWith: "SIGKILL" });

    const result = runClaude(fake.env, ["-p"]);

    expect(result.signal).toBe("SIGKILL");
    expect(result.stdout).toBe("{}\n");
  });

  it("does not read a control name from the env", () => {
    const fake = useFakeClaude({ stream: ["{}"] });
    const env = childEnv(
      { ...fake.env, TASKER_FAKE_CLAUDE_EXIT: "9", FAKE_CLAUDE_EXIT: "9", ANTHROPIC_API_KEY: "k" },
      [],
    );

    const result = runClaude(env, ["-p"]);

    expect(result.status).toBe(0);
    const names = fake.calls()[0]!.envNames;
    expect(names).toEqual(expect.arrayContaining(["HOME", "PATH"]));
    expect(names).not.toContain("TASKER_FAKE_CLAUDE_EXIT");
    expect(names).not.toContain("FAKE_CLAUDE_EXIT");
    expect(names).not.toContain("ANTHROPIC_API_KEY");
  });
});

describe("useFakeClaude with settings and placeholders", () => {
  it("logs the parsed settings, and none when the call has no --settings", () => {
    const fake = useFakeClaude({});
    const settings = { sandbox: { enabled: true, filesystem: { allowWrite: ["/a"] } } };

    runClaude(fake.env, ["-p", "--settings", JSON.stringify(settings), "--model", "x"]);
    runClaude(fake.env, ["-p"]);

    const calls = fake.calls();
    expect(calls[0]!.settings).toEqual(settings);
    expect(calls[1]).not.toHaveProperty("settings");
  });

  it("makes the placeholders in its cwd before it is killed", () => {
    const fake = useFakeClaude({ placeholders: [".bashrc", ".claude/settings.json"], killWith: "SIGKILL" });
    const cwd = useTempDir("tasker-fake-cwd-");

    const result = spawnSync("claude", ["-p"], { env: fake.env, cwd, encoding: "utf8" });

    expect(result.signal).toBe("SIGKILL");
    for (const name of [".bashrc", ".claude/settings.json"]) {
      const stat = lstatSync(join(cwd, name));
      expect(stat.size).toBe(0);
      expect(stat.mode & 0o777).toBe(0o444);
    }
  });
});

describe("writePlaceholder", () => {
  it("makes the parent folders and an empty file with mode 0o444", () => {
    const root = useTempDir("tasker-placeholder-");

    writePlaceholder(root, ".claude/hooks");

    const stat = lstatSync(join(root, ".claude", "hooks"));
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(0);
    expect(stat.mode & 0o777).toBe(0o444);
  });
});

describe("validPlanAnswer", () => {
  it("gives an answer that passes the plan checks", () => {
    expect(checkPlanAnswer(validPlanAnswer())).toEqual({ ok: true, answer: validPlanAnswer() });
  });

  it("replaces only the changed field", () => {
    const answer = validPlanAnswer({ summary: ["Other."] });

    expect(answer.summary).toEqual(["Other."]);
    expect({ ...answer, summary: validPlanAnswer().summary }).toEqual(validPlanAnswer());
  });

  it("gives separate objects for each call", () => {
    const first = validPlanAnswer();
    first.todos[0]!.title = "changed";
    first.files_changed.push("x");

    expect(validPlanAnswer().todos[0]!.title).toBe("Add the a module");
    expect(validPlanAnswer().files_changed).toEqual(["src/a.ts", "test/a.test.ts"]);
  });
});

describe("seedPlanRevision", () => {
  it("writes the plan_revision event, sets awaiting_plan_review and writes no transition", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      const before = store.listEvents(task.id).length;

      seedPlanRevision(store, task.id);

      expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
      expect(store.listEvents(task.id).slice(before).map(({ type, data }) => ({ type, data }))).toEqual([
        { type: "plan_revision", data: { version: 1, prompt: "plan@000000000000" } },
      ]);
    });
  });

  it("sets the given state", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      seedPlanRevision(store, task.id, {}, "approved");

      expect(store.getTask(task.id)?.state).toBe("approved");
    });
  });

  it("gives the versions 1 and 2 for consecutive calls", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      expect(seedPlanRevision(store, task.id).version).toBe(1);
      expect(seedPlanRevision(store, task.id).version).toBe(2);
    });
  });

  it("gives a valid answer unless the call changes it", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      expect(seedPlanRevision(store, task.id).answer).toEqual(validPlanAnswer());
    });
  });

  it("keeps a given feedback and source", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      const revision = seedPlanRevision(store, task.id, { feedback: "use main", source: "refine" });

      expect(revision).toMatchObject({ feedback: "use main", source: "refine" });
    });
  });
});

describe("recordTestPlanRevision", () => {
  it("writes the plan file and the row and moves the task to awaiting_plan_review", () => {
    const dataRoot = useTempDir("tasker-record-");
    withDataRootStore(dataRoot, (store) => {
      const task = seedTask(store);
      const markdown = "## Summary\n\nhelper text\n";

      recordTestPlanRevision(store, dataRoot, task.id, {
        answer: validPlanAnswer({ plan_markdown: markdown }),
      });

      expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
      expect(store.getPlanRevision(task.id, 1)).toBeDefined();
      expect(readFileSync(planRevisionPath(dataRoot, task, 1), "utf8")).toBe(markdown);
    });
  });
});

describe("seedPlanningTask", () => {
  it("seeds the task of codeguru42/tasker#5 in the state planning in the data root", () => {
    const { dataRoot, task } = seedPlanningTask();

    expect(task).toMatchObject({ issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state: "planning" });
    const found = withDataRootStore(dataRoot, (store) =>
      store.findLatestTask("codeguru42/tasker", "codeguru42/tasker#5"),
    );
    expect(found?.id).toBe(task.id);
  });
});

describe("recordPlanRevisions", () => {
  it("records v1 with its plan file and leaves the task in awaiting_plan_review", () => {
    const { dataRoot, task } = seedPlanningTask();
    const markdown = "## Summary\n\nfirst\n";

    recordPlanRevisions(dataRoot, task, { answer: validPlanAnswer({ plan_markdown: markdown }) });

    withDataRootStore(dataRoot, (store) => {
      expect(store.getPlanRevision(task.id, 1)).toBeDefined();
      expect(store.getPlanRevision(task.id, 2)).toBeUndefined();
      expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
    });
    expect(readFileSync(planRevisionPath(dataRoot, task, 1), "utf8")).toBe(markdown);
  });

  it("with second, records v2 after the refining state with its plan file", () => {
    const { dataRoot, task } = seedPlanningTask();
    const markdown = "## Summary\n\nsecond\n";

    recordPlanRevisions(
      dataRoot,
      task,
      {},
      { source: "refine", feedback: "Use main.", answer: validPlanAnswer({ plan_markdown: markdown }) },
    );

    withDataRootStore(dataRoot, (store) => {
      expect(store.getPlanRevision(task.id, 2)).toMatchObject({ source: "refine", feedback: "Use main." });
      expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
    });
    expect(readFileSync(planRevisionPath(dataRoot, task, 2), "utf8")).toBe(markdown);
  });
});

describe("seedPlanSession", () => {
  it("records TEST_SESSION_ID with the plan model of the test configurations", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      const session = seedPlanSession(store, task.id);

      expect(session).toEqual({
        sessionId: TEST_SESSION_ID,
        repoKey: "a/b",
        provider: "claude-code",
        model: "opus",
        effort: "high",
      });
      expect(store.planSession(task.id)).toEqual(session);
    });
  });

  it("uses the values that the call changes", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      const session = seedPlanSession(store, task.id, { sessionId: "x", effort: "low" });

      expect(session).toMatchObject({ sessionId: "x", effort: "low", model: "opus", provider: "claude-code" });
    });
  });
});

describe("seedExecuteSession", () => {
  it("records TEST_EXECUTE_SESSION_ID with the execute model of the test configurations", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      seedPlanRevision(store, task.id);

      const session = seedExecuteSession(store, task.id, 1);

      expect(session).toEqual({
        sessionId: TEST_EXECUTE_SESSION_ID,
        repoKey: "a/b",
        provider: "claude-code",
        model: "sonnet",
        effort: "medium",
      });
      expect(store.executeSession(task.id, 1)).toEqual(session);
    });
  });

  it("uses the values that the call changes", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      seedPlanRevision(store, task.id);

      const session = seedExecuteSession(store, task.id, 1, { sessionId: "x", effort: "low" });

      expect(session).toMatchObject({ sessionId: "x", effort: "low", model: "sonnet", provider: "claude-code" });
    });
  });
});

describe("seedExecuteTodoStates", () => {
  it("sets the state of each todo that the record names", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      seedPlanRevision(store, task.id);

      seedExecuteTodoStates(store, task.id, 1, { "write-test": "done", "make-it-pass": "in_progress" });

      expect(store.executeTodoProgress(task.id, 1).map(({ todo, state }) => [todo.id, state])).toEqual([
        ["write-test", "done"],
        ["make-it-pass", "in_progress"],
      ]);
    });
  });

  it("leaves each todo not started for an empty record", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      seedPlanRevision(store, task.id);

      seedExecuteTodoStates(store, task.id, 1, {});

      expect(store.executeTodoProgress(task.id, 1).map(({ state }) => state)).toEqual([
        "not_started",
        "not_started",
      ]);
    });
  });
});

describe("planAnswerStream", () => {
  it("gives a last line whose structured_output is the answer", () => {
    const answer = validPlanAnswer({ summary: ["Another."] });
    const lines = planAnswerStream(answer);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ structured_output: answer });
  });
});

describe("usePlanFixture", () => {
  it("puts the fake claude first on PATH, sets a temp HOME and keeps the task in workspace_ready", async () => {
    const hostHome = process.env.HOME;
    const { started, claude } = await usePlanFixture({});
    expect(process.env.PATH!.startsWith(claude.binDir + delimiter)).toBe(true);
    expect(process.env.HOME).not.toBe(hostHome);
    expect(existsSync(process.env.HOME!)).toBe(true);
    const state = withDataRootStore(started.dataRoot, (store) => store.findLatestTask(started.repoKey, started.key)?.state);
    expect(state).toBe("workspace_ready");
  });
});
