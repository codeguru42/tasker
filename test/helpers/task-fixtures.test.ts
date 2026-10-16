import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { canTransition, failTask, type TaskState } from "../../src/state/machine.js";
import { loadConfig } from "../../src/config/load.js";
import { issueProviderFor } from "../../src/issues/provider.js";
import { baseRevisionOf } from "../../src/tasks/base-revision.js";
import { dataRootLayout, planRevisionPath } from "../../src/store/layout.js";
import { changedPaths } from "../../src/vcs/git/changes.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { localBranches } from "./git.js";
import { TEST_SESSION_ID } from "./fake-claude.js";
import { planTodo, validPlanAnswer } from "./plan.js";
import {
  dayAt,
  databasePathOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  seedTasks,
  withDataRootStore,
} from "./store.js";
import { useTempDir } from "./temp.js";
import {
  expectCommandRefused,
  expectNoAssistantRun,
  expectRefusedWithoutChange,
  moveTaskThrough,
  startIssueTask,
  startTaskWithCommits,
  taskRefOf,
  taskWorkspaceState,
  TO_WORK_REVIEW,
  useAssistantRunFixture,
  useExecuteFixture,
  useRefineFixture,
  usePlanFixture,
  useStartedTask,
  useReviewFixture,
  useSeededTask,
  useStartFixture,
  useVerifyFixture,
  useWorkReviewTask,
} from "./task-fixtures.js";

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
    expect(process.env.PATH?.startsWith(`${String(fixture.gh.env.PATH)}${delimiter}`)).toBe(true);
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

describe("useSeededTask", () => {
  it("seeds the task of issue 5 and puts a fake claude first on PATH", async () => {
    const seeded = await useSeededTask(
      { stream: ["one"] },
      { state: "executed", worktreePath: "/work/tree", branch: "tasker/five" },
    );

    expect(seeded.key).toBe("codeguru42/tasker#5");
    expect(seeded.repoKey).toBe("codeguru42/tasker");
    expect(latestTaskOf(seeded.dataRoot, seeded.key)).toMatchObject({
      state: "executed",
      worktreePath: "/work/tree",
      branch: "tasker/five",
    });
    expect(String(process.env.PATH).startsWith(seeded.claude.binDir + delimiter)).toBe(true);
    expect(seeded.claude.calls()).toEqual([]);
  });
});

describe("useStartFixture with limits", () => {
  it("sets the limits in the configuration file and keeps the other limits", async () => {
    const before = (await useStartFixture()).config.limits;
    const fixture = await useStartFixture({ limits: { planTimeoutMin: 0.05 } });

    expect(fixture.config.limits).toEqual({ ...before, planTimeoutMin: 0.05 });
    expect(loadConfig().limits).toEqual({ ...before, planTimeoutMin: 0.05 });
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
    expect(fixture.config.repos[repoKey].vcs).toEqual({ provider: "git", config: { sshKey: "/keys/a_key" } });
    expect(fixture.config.repos["codeguru42/other"].vcs).toEqual({
      provider: "git",
      config: { sshKey: "/keys/b_key" },
    });
    expect(Object.keys(fixture.started.config.repos)).toEqual([repoKey]);
    expect(fixture.started.config.repos[repoKey].vcs).toEqual({ provider: "git", config: {} });
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

describe("usePlanFixture", () => {
  it("puts the fake claude first on PATH, sets a temp HOME and keeps the task in workspace_ready", async () => {
    const hostHome = process.env.HOME;
    const { started, claude } = await usePlanFixture({});
    expect(process.env.PATH!.startsWith(claude.binDir + delimiter)).toBe(true);
    expect(process.env.HOME).not.toBe(hostHome);
    expect(existsSync(process.env.HOME!)).toBe(true);
    const state = withDataRootStore(
      started.dataRoot,
      (store) => store.findLatestTask(started.repoKey, started.key)?.state,
    );
    expect(state).toBe("workspace_ready");
  });
});

describe("expectNoAssistantRun", () => {
  it("passes for a new plan fixture", async () => {
    const fixture = await usePlanFixture({});

    expect(() => expectNoAssistantRun(fixture)).not.toThrow();
  });

  it("throws when a lock row exists", async () => {
    const fixture = await usePlanFixture({});
    withDataRootStore(fixture.started.dataRoot, (store) => store.tryLock("x"));

    expect(() => expectNoAssistantRun(fixture)).toThrow();
  });

  it("throws after one run of the fake claude", async () => {
    const fixture = await usePlanFixture({});
    execFileSync(join(fixture.claude.binDir, "claude"), ["--version"]);

    expect(() => expectNoAssistantRun(fixture)).toThrow();
  });
});

describe("useRefineFixture", () => {
  it("leaves the task in awaiting_plan_review with no run marker", async () => {
    const fixture = await useRefineFixture({});
    const task = latestTaskOf(fixture.started.dataRoot, fixture.started.key);

    expect(fixture.task.id).toBe(task.id);
    expect(task.state).toBe("awaiting_plan_review");
    expect(readRunMarker(databasePathOf(fixture.started.dataRoot), task.id)).toBeUndefined();
  });

  it("writes v1.md with the plan_markdown of the answer", async () => {
    const answer = validPlanAnswer({ plan_markdown: "## Summary\n\nOther plan.\n" });
    const fixture = await useRefineFixture({}, { answer });

    expect(fixture.revision.version).toBe(1);
    expect(readFileSync(planRevisionPath(fixture.started.dataRoot, fixture.task, 1), "utf8")).toBe(
      answer.plan_markdown,
    );
  });

  it("records the plan session", async () => {
    const fixture = await useRefineFixture({});

    expect(fixture.session).toMatchObject({ sessionId: TEST_SESSION_ID, provider: "claude-code", model: "opus" });
    expect(withDataRootStore(fixture.started.dataRoot, (store) => store.planSession(fixture.task.id))).toEqual(
      fixture.session,
    );
  });

  it("records the model of options.session", async () => {
    const fixture = await useRefineFixture({}, { session: { model: "gpt-5" } });

    expect(fixture.session.model).toBe("gpt-5");
  });

  it("gives options.limits to the configuration", async () => {
    const fixture = await useRefineFixture({}, { limits: { planTimeoutMin: 0.05 } });

    expect(fixture.started.config.limits.planTimeoutMin).toBe(0.05);
  });
});

describe("useExecuteFixture", () => {
  const todos = [planTodo("b", ["a"]), planTodo("a")];

  it("leaves the task in approved with revision v1 pinned and the given todos", async () => {
    const fixture = await useExecuteFixture({}, { answer: { todos } });
    const { dataRoot } = fixture.started;

    expect(fixture.task.state).toBe("approved");
    expect(latestTaskOf(dataRoot, fixture.started.key).state).toBe("approved");
    withDataRootStore(dataRoot, (store) => {
      const pinned = store.pinnedPlanRevision(fixture.task.id);
      expect(pinned?.version).toBe(1);
      expect(pinned?.answer.todos).toEqual(todos);
    });
    expect(fixture.revision.version).toBe(1);
  });

  it("has the plan file, the worktree and a base revision", async () => {
    const fixture = await useExecuteFixture({});
    const { dataRoot, worktree } = fixture.started;

    expect(existsSync(planRevisionPath(dataRoot, fixture.task, 1))).toBe(true);
    expect(existsSync(worktree)).toBe(true);
    expect(withDataRootStore(dataRoot, (store) => baseRevisionOf(store, fixture.task.id))).toBeDefined();
  });

  it("puts the fake bwrap on PATH and gives the configuration and the env", async () => {
    const fixture = await useExecuteFixture({});

    expect(fixture.config).toBe(fixture.started.config);
    expect(fixture.env.PATH).toBe(process.env.PATH);
    const found = process.env.PATH!.split(delimiter).some((dir) => existsSync(join(dir, "bwrap")));
    expect(found).toBe(true);
    expect(process.env.PATH!.includes(fixture.claude.binDir)).toBe(true);
  });
});

describe("taskRefOf", () => {
  it("gives the key, the repo key and the short ref of issue 5", async () => {
    const started = await useStartedTask();

    expect(taskRefOf(started)).toEqual({ key: started.key, repoKey: started.repoKey, shortRef: "issue-5" });
  });
});

describe("expectRefusedWithoutChange", () => {
  it("gives the error of a call that throws the message and changes nothing", async () => {
    const started = await useStartedTask();

    const error = await expectRefusedWithoutChange(
      started,
      () => Promise.reject(new Error("refused: reason")),
      "refused",
    );

    expect(error.message).toBe("refused: reason");
  });

  it("fails when the call does not throw", async () => {
    const started = await useStartedTask();

    await expect(expectRefusedWithoutChange(started, () => Promise.resolve(), "refused")).rejects.toThrow();
  });

  it("fails when the message does not start with the text", async () => {
    const started = await useStartedTask();

    await expect(
      expectRefusedWithoutChange(started, () => Promise.reject(new Error("other")), "refused"),
    ).rejects.toThrow();
  });

  it("fails when the call changes the state", async () => {
    const started = await useStartedTask();
    const call = async () => {
      withDataRootStore(started.dataRoot, (store) =>
        failTask(store, latestTaskOf(started.dataRoot, started.key).id, "x"),
      );
      throw new Error("refused");
    };

    await expect(expectRefusedWithoutChange(started, call, "refused")).rejects.toThrow();
  });

  it("fails when the call adds an event", async () => {
    const started = await useStartedTask();
    const call = async () => {
      withDataRootStore(started.dataRoot, (store) =>
        store.appendEvent(latestTaskOf(started.dataRoot, started.key).id, "note"),
      );
      throw new Error("refused");
    };

    await expect(expectRefusedWithoutChange(started, call, "refused")).rejects.toThrow();
  });
});

describe("expectCommandRefused", () => {
  const refused = (err: string) => () => Promise.resolve({ code: 1, out: "", err });

  it("passes for a refusal with the exact error", async () => {
    const started = await useStartedTask();

    await expectCommandRefused(started, refused("refused: reason\n"), "refused: reason\n");
  });

  it("passes for a refusal whose error matches the RegExp", async () => {
    const started = await useStartedTask();

    await expectCommandRefused(started, refused("refused: reason\n"), /^refused: /);
  });

  it("fails when the error is not the exact text", async () => {
    const started = await useStartedTask();

    await expect(expectCommandRefused(started, refused("refused: reason\n"), "refused")).rejects.toThrow();
  });

  it("fails when the exit code is not 1 or stdout is not empty", async () => {
    const started = await useStartedTask();

    await expect(
      expectCommandRefused(started, () => Promise.resolve({ code: 0, out: "", err: "x" }), "x"),
    ).rejects.toThrow();
    await expect(
      expectCommandRefused(started, () => Promise.resolve({ code: 1, out: "y", err: "x" }), "x"),
    ).rejects.toThrow();
  });

  it("fails when the run writes an event and returns code 1", async () => {
    const started = await useStartedTask();
    const run = async () => {
      withDataRootStore(started.dataRoot, (store) =>
        store.appendEvent(latestTaskOf(started.dataRoot, started.key).id, "note"),
      );
      return { code: 1, out: "", err: "x" };
    };

    await expect(expectCommandRefused(started, run, "x")).rejects.toThrow();
  });
});

describe("useVerifyFixture", () => {
  it("gives a task in executed with a worktree path and no lock row", async () => {
    const fixture = await useVerifyFixture({ commands: ["true", "echo hi"], limits: { verifyTimeoutMin: 3 } });
    const { dataRoot } = fixture.started;

    expect(fixture.task.state).toBe("executed");
    expect(latestTaskOf(dataRoot, fixture.started.key).state).toBe("executed");
    expect(fixture.task.worktreePath).toBe(fixture.started.worktree);
    expect(lockNames(dataRoot)).toEqual([]);
  });

  it("puts the verify commands and the limits in the configuration", async () => {
    const fixture = await useVerifyFixture({ commands: ["true", "echo hi"], limits: { verifyTimeoutMin: 3 } });

    expect(fixture.config).toBe(fixture.started.config);
    expect(fixture.config.repos[fixture.started.repoKey].verify.commands).toEqual(["true", "echo hi"]);
    expect(fixture.config.limits.verifyTimeoutMin).toBe(3);
    expect(fixture.env).toBe(fixture.started.env);
  });
});

describe("useWorkReviewTask", () => {
  const changedFiles = (work: Awaited<ReturnType<typeof useWorkReviewTask>>) =>
    changedPaths({
      clone: work.clone,
      env: work.env,
      branch: work.task.branch!,
      baseRevision: "refs/remotes/origin/main",
    });

  it("gives a task in awaiting_work_review with a worktree path, a branch and one commit", async () => {
    const work = await useWorkReviewTask();

    expect(work.key).toBe("codeguru42/tasker#5");
    expect(work.task.state).toBe("awaiting_work_review");
    expect(latestTaskOf(work.dataRoot, work.key).state).toBe("awaiting_work_review");
    expect(work.task.worktreePath).not.toBeNull();
    expect(work.task.branch).not.toBeNull();
    expect(await changedFiles(work)).toEqual(["work.txt"]);
  });

  it("commits each given file and leaves no run marker", async () => {
    const work = await useWorkReviewTask({ files: ["src/a.ts", "docs/b.md"] });

    expect([...(await changedFiles(work))].sort()).toEqual(["docs/b.md", "src/a.ts"]);
    expect(readRunMarker(databasePathOf(work.dataRoot), work.task.id)).toBeUndefined();
    expect(lockNames(work.dataRoot)).toEqual([]);
  });
});

describe("useReviewFixture", () => {
  it("gives a task in awaiting_work_review and puts the fake claude first on PATH", async () => {
    const fixture = await useReviewFixture({ stream: ["one"] });

    expect(fixture.task.state).toBe("awaiting_work_review");
    expect(fixture.task.worktreePath).not.toBeNull();
    expect(fixture.task.branch).not.toBeNull();
    expect(process.env.PATH?.startsWith(`${fixture.claude.binDir}${delimiter}`)).toBe(true);
    expect(fixture.claude.calls()).toEqual([]);
  });
});

describe("TO_WORK_REVIEW", () => {
  it("lists the states from planning to awaiting_work_review in the order of the main path", () => {
    expect(TO_WORK_REVIEW).toEqual([
      "planning",
      "awaiting_plan_review",
      "approved",
      "executing",
      "executed",
      "verifying",
      "awaiting_work_review",
    ]);
  });

  it("is a legal walk from workspace_ready", () => {
    const steps: TaskState[] = ["workspace_ready", ...TO_WORK_REVIEW];

    steps.slice(1).forEach((to, index) => {
      expect(canTransition(steps[index], to)).toBe(true);
    });
  });
});

describe("moveTaskThrough", () => {
  const seedReadyTask = () => {
    const dataRoot = useTempDir("tasker-move-");
    const [task] = seedTasks(dataRoot, [{ issueKey: "a/b#1", repoKey: "a/b", state: "workspace_ready", at: dayAt(1) }]);
    return { dataRoot, id: task.id };
  };
  const move = (dataRoot: string, id: number, states: Parameters<typeof moveTaskThrough>[2]) =>
    withDataRootStore(dataRoot, (store) => ({
      task: moveTaskThrough(store, id, states),
      transitions: store
        .listEvents(id)
        .filter((event) => event.type === "transition")
        .map((event) => event.data),
    }));

  it("moves the task through the states in order and gives the task after the last move", () => {
    const { dataRoot, id } = seedReadyTask();

    const { task, transitions } = move(dataRoot, id, ["planning", "awaiting_plan_review"]);

    expect(task.state).toBe("awaiting_plan_review");
    expect(transitions).toMatchObject([
      { from: "workspace_ready", to: "planning" },
      { from: "planning", to: "awaiting_plan_review" },
    ]);
  });

  it("changes nothing for an empty list", () => {
    const { dataRoot, id } = seedReadyTask();

    const { task, transitions } = move(dataRoot, id, []);

    expect(task.state).toBe("workspace_ready");
    expect(transitions).toEqual([]);
  });
});
