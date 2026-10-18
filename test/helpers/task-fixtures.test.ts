import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { canTransition, failTask, transitionFromEvents, type TaskState } from "../../src/state/machine.js";
import { loadConfig } from "../../src/config/load.js";
import type { IssueRef } from "../../src/issue-key/ref.js";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import { issueProviderFor } from "../../src/issues/provider.js";
import { baseRevisionOf } from "../../src/tasks/base-revision.js";
import { dataRootLayout, planRevisionPath } from "../../src/store/layout.js";
import { changedPaths } from "../../src/vcs/git/changes.js";
import { runGit } from "../../src/vcs/git/run.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { failureOf } from "./errors.js";
import { githubBlockersAnswer, githubWriteAnswer, trackerWriteCalls } from "./fake-gh.js";
import { GIT_TEST_IDENTITY, commitInWorktree, localBranches } from "./git.js";
import { TEST_SESSION_ID } from "./fake-claude.js";
import { answerStream, planTodo, validPlanAnswer } from "./plan.js";
import {
  dayAt,
  databasePathOf,
  eventsOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  seedTasks,
  withDataRootStore,
} from "./store.js";
import { useTempDir } from "./temp.js";
import {
  useStackedTasks,
  appendBaseEvent,
  landParent,
  expectCommandRefused,
  expectNoAssistantRun,
  expectRefusedWithoutChange,
  landAcceptedTask,
  moveTaskThrough,
  pausePlanFixtureRefine,
  pausePlanFixtureTask,
  seedAcceptedTask,
  startIssueTask,
  startTaskWithCommits,
  taskBranchTipOf,
  taskRefOf,
  taskWorkspaceState,
  TO_WORK_REVIEW,
  useAcceptedTask,
  useAssistantRunFixture,
  useExecuteFixture,
  useLandedTask,
  useRefineFixture,
  useReviewedRefineFixture,
  usePlanFixture,
  useStartedTask,
  useReviewFixture,
  useSeededTask,
  trackerRepo,
  useStartFixture,
  useVerifyFixture,
  useMovedBaseTask,
  useWorkReviewTask,
  type StartFixture,
} from "./task-fixtures.js";

// The ref of codeguru42/tasker#<n> in the repo of the fixture, with the short ref that the code makes.
function issueRefOf(fixture: Pick<StartFixture, "repoKey">, n: number): IssueRef {
  return { key: `codeguru42/tasker#${n}`, repoKey: fixture.repoKey, shortRef: githubShortRef(String(n)) };
}

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
    const ref = issueRefOf(fixture, 5);

    const issue = await provider.fetchIssue(ref, process.env);

    expect(issue.title).toBe("Issue 5");
  });

  it("answers the read of the blockers of each issue with no blockers", async () => {
    const fixture = await useStartFixture({
      issues: [
        { project: "codeguru42/tasker", number: 5 },
        { project: "codeguru42/tasker", number: 6 },
      ],
    });
    const provider = issueProviderFor(fixture.config, fixture.repoKey);

    await expect(provider.blockingIssues(issueRefOf(fixture, 5), process.env)).resolves.toEqual([]);
    await expect(provider.blockingIssues(issueRefOf(fixture, 6), process.env)).resolves.toEqual([]);
  });

  it("lets a blockers answer of ghAnswers win over the default", async () => {
    const fixture = await useStartFixture({
      ghAnswers: [
        githubBlockersAnswer({ project: "codeguru42/tasker", number: 5, blockers: [{ number: 3, state: "OPEN" }] }),
      ],
    });
    const provider = issueProviderFor(fixture.config, fixture.repoKey);
    const ref = issueRefOf(fixture, 5);

    await expect(provider.blockingIssues(ref, process.env)).resolves.toEqual([
      { key: "codeguru42/tasker#3", state: "open" },
    ]);
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

describe("pausePlanFixtureTask", () => {
  it("gives the task a plan session and pauses it from the origin with the data", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
    const { dataRoot, repoKey, key } = fixture.started;
    const data = { utilization: 0.95, resetsAt: 1792206000 };

    const task = pausePlanFixtureTask(fixture, "planning", "awaiting_quota_approval", data);

    expect(task.state).toBe("awaiting_quota_approval");
    withDataRootStore(dataRoot, (store) => {
      const stored = store.findLatestTask(repoKey, key)!;
      expect(stored.state).toBe("awaiting_quota_approval");
      expect(transitionFromEvents(store.listEvents(stored.id), "awaiting_quota_approval")).toBe("planning");
      expect(store.planSession(stored.id)).toMatchObject({ sessionId: TEST_SESSION_ID });
    });
    expect(eventsOf(dataRoot, key).at(-1)).toMatchObject({ data: data });
  });
});

describe("pausePlanFixtureRefine", () => {
  it("gives the task a plan session and pauses it after a refine from the origin with the data", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
    const { dataRoot, repoKey, key } = fixture.started;
    const data = { cause: "overage", resetsAt: 1792206000 };

    const task = pausePlanFixtureRefine(fixture, "accepted", "quota_blocked", data);

    expect(task.state).toBe("quota_blocked");
    withDataRootStore(dataRoot, (store) => {
      const stored = store.findLatestTask(repoKey, key)!;
      const events = store.listEvents(stored.id);
      expect(stored.state).toBe("quota_blocked");
      expect(transitionFromEvents(events, "quota_blocked")).toBe("refining");
      expect(transitionFromEvents(events, "refining")).toBe("accepted");
      expect(store.planSession(stored.id)).toMatchObject({ sessionId: TEST_SESSION_ID });
    });
    expect(eventsOf(dataRoot, key).at(-1)).toMatchObject({ data });
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

describe("useReviewedRefineFixture", () => {
  it("leaves the task in reviewed with the plan session, verify run 1 and review 1 with two open findings", async () => {
    const fixture = await useReviewedRefineFixture({});
    const { dataRoot, key } = fixture.started;

    expect(latestTaskOf(dataRoot, key).state).toBe("reviewed");
    expect(fixture.task.state).toBe("reviewed");
    expect(fixture.session).toMatchObject({ sessionId: TEST_SESSION_ID, provider: "claude-code", model: "opus" });
    expect(fixture.verifyRun?.number).toBe(1);
    expect(fixture.review?.number).toBe(1);
    expect(fixture.review?.findings.map((entry) => entry.dismissed)).toEqual([null, null]);
  });

  it("seeds no verify run for verifyRun: false", async () => {
    const fixture = await useReviewedRefineFixture({}, { verifyRun: false });

    expect(fixture.verifyRun).toBeUndefined();
    expect(
      withDataRootStore(fixture.started.dataRoot, (store) => store.latestVerifyRun(fixture.task.id)),
    ).toBeUndefined();
    expect(fixture.task.state).toBe("reviewed");
  });

  it("leaves the task in reviewed with no review for review: null", async () => {
    const fixture = await useReviewedRefineFixture({}, { review: null });

    expect(fixture.review).toBeUndefined();
    expect(fixture.task.state).toBe("reviewed");
    expect(withDataRootStore(fixture.started.dataRoot, (store) => store.latestReview(fixture.task.id))).toBeUndefined();
  });

  it("leaves the task in awaiting_work_review with review 1 for state: awaiting_work_review", async () => {
    const fixture = await useReviewedRefineFixture({}, { state: "awaiting_work_review" });

    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("awaiting_work_review");
    expect(fixture.task.state).toBe("awaiting_work_review");
    expect(fixture.review?.number).toBe(1);
    expect(fixture.verifyRun?.number).toBe(1);
  });

  it("leaves the task in awaiting_work_review with no review for that state and review: null", async () => {
    const fixture = await useReviewedRefineFixture({}, { state: "awaiting_work_review", review: null });

    expect(fixture.review).toBeUndefined();
    expect(fixture.task.state).toBe("awaiting_work_review");
    expect(withDataRootStore(fixture.started.dataRoot, (store) => store.latestReview(fixture.task.id))).toBeUndefined();
  });

  it("leaves the task in awaiting_work_review with no verify run for that state and verifyRun: false", async () => {
    const fixture = await useReviewedRefineFixture({}, { state: "awaiting_work_review", verifyRun: false });

    expect(fixture.verifyRun).toBeUndefined();
    expect(fixture.task.state).toBe("awaiting_work_review");
    expect(
      withDataRootStore(fixture.started.dataRoot, (store) => store.latestVerifyRun(fixture.task.id)),
    ).toBeUndefined();
  });

  it("gives the findings of options.review to the review", async () => {
    const fixture = await useReviewedRefineFixture({}, { review: { findings: [] } });

    expect(fixture.review?.findings).toEqual([]);
  });

  it("gives options.limits to the configuration", async () => {
    const fixture = await useReviewedRefineFixture({}, { limits: { planTimeoutMin: 0.05 } });

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

describe("appendBaseEvent", () => {
  it("appends an explicit base event to the task", () => {
    const dataRoot = useTempDir("tasker-base-event-");
    const [task] = seedTasks(dataRoot, [
      { issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state: "accepted", at: dayAt(1) },
    ]);

    const event = appendBaseEvent({ dataRoot, task }, "refs/heads/x", "refs/heads/x");

    expect(event).toMatchObject({
      type: "base",
      data: { base: "refs/heads/x", revision: "refs/heads/x", source: "explicit" },
    });
    expect(eventsOf(dataRoot, "codeguru42/tasker#5").at(-1)).toEqual({
      type: "base",
      data: { base: "refs/heads/x", revision: "refs/heads/x", source: "explicit" },
    });
  });
});

describe("taskBranchTipOf", () => {
  it("gives the tip of the task branch", async () => {
    const work = await useWorkReviewTask();
    const head = await commitInWorktree(work.task.worktreePath!, work.env, { file: "more.txt" });

    expect(await taskBranchTipOf(work)).toBe(head);
  });

  it("reads the branch, not a detached HEAD of the worktree", async () => {
    const work = await useWorkReviewTask();
    const worktree = work.task.worktreePath!;
    const tip = await commitInWorktree(worktree, work.env, { file: "more.txt" });
    await runGit(["switch", "--detach"], { cwd: worktree, env: work.env });
    const detached = await commitInWorktree(worktree, work.env, { file: "detached.txt" });

    expect(detached).not.toBe(tip);
    expect(await taskBranchTipOf(work)).toBe(tip);
  });

  it("throws for a task with no branch", async () => {
    const work = await useWorkReviewTask();

    const error = await failureOf(taskBranchTipOf({ ...work, task: { ...work.task, branch: null } }), Error);

    expect(error.message).toBe("the task has no branch");
  });
});

describe("useAcceptedTask", () => {
  it("gives a task in accepted with the revision that accept recorded", async () => {
    const accepted = await useAcceptedTask();
    const branch = String(accepted.task.branch);

    expect(accepted.task.state).toBe("accepted");
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("accepted");
    expect(accepted.revision).toBe(await taskBranchTipOf(accepted));
    expect(
      await changedPaths({
        clone: accepted.clone,
        env: accepted.env,
        branch,
        baseRevision: "refs/remotes/origin/main",
      }),
    ).toEqual(["work.txt"]);
    expect(await accepted.origin.branchHead("main")).not.toBe(accepted.revision);
  });
});

describe("useLandedTask", () => {
  it("gives a task in landed with its worktree and its branch", async () => {
    const landed = await useLandedTask();

    expect(landed.task.state).toBe("landed");
    expect(latestTaskOf(landed.dataRoot, landed.key).state).toBe("landed");
    expect(await taskWorkspaceState(landed)).toEqual({ state: "landed", worktree: true, listed: true, branch: true });
    expect(await landed.origin.branchHead("main")).toBe(landed.revision);
  });
});

describe("landAcceptedTask", () => {
  it("makes the head of the task branch the head of main on origin", async () => {
    const accepted = await useAcceptedTask();

    await landAcceptedTask(accepted);

    expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
  });
});

describe("seedAcceptedTask", () => {
  it("seeds the task of issue 5 in accepted with the given branch and base", () => {
    const dataRoot = useTempDir("tasker-seed-accepted-");

    const task = seedAcceptedTask({ dataRoot }, { branch: "tasker/five", base: "main" });

    expect(task).toMatchObject({
      issueKey: "codeguru42/tasker#5",
      repoKey: "codeguru42/tasker",
      state: "accepted",
      branch: "tasker/five",
      base: "main",
    });
    expect(latestTaskOf(dataRoot, "codeguru42/tasker#5").id).toBe(task.id);
  });

  it("leaves the branch and the base empty when it gets none", () => {
    const task = seedAcceptedTask({ dataRoot: useTempDir("tasker-seed-accepted-") });

    expect(task.branch).toBeNull();
    expect(task.base).toBeNull();
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

describe("useStackedTasks", () => {
  it("gives the parent in awaiting_work_review and the stacked task in executed", async () => {
    const fixture = await useStackedTasks();

    expect(fixture.parent.key).toBe("codeguru42/tasker#5");
    expect(fixture.stacked.key).toBe("codeguru42/tasker#6");
    expect(latestTaskOf(fixture.dataRoot, fixture.parent.key).state).toBe("awaiting_work_review");
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("executed");
    expect(fixture.parent.task.state).toBe("awaiting_work_review");
    expect(fixture.stacked.task.state).toBe("executed");
  });

  it("bases the stacked task on the branch of the parent", async () => {
    const fixture = await useStackedTasks();

    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).base).toBe(`refs/heads/${fixture.parent.branch}`);
  });

  it("puts the commit of the parent on the stacked branch", async () => {
    const fixture = await useStackedTasks();
    const files = (await runGit(["ls-files"], { cwd: fixture.stacked.worktree, env: fixture.env })).split("\n");

    expect(files).toContain("parent.txt");
    expect(files).toContain("stacked.txt");
    expect(existsSync(join(fixture.parent.worktree, "stacked.txt"))).toBe(false);
  });
});

describe("landParent", () => {
  it("makes the tip of the parent branch the head of main on origin and moves the parent task", async () => {
    const fixture = await useStackedTasks();
    const tip = await runGit(["rev-parse", `refs/heads/${fixture.parent.branch}`], {
      gitDir: fixture.clone,
      env: fixture.env,
    });

    await landParent(fixture, ["accepted", "landed"]);

    expect(await fixture.origin.branchHead("main")).toBe(tip.trim());
    expect(latestTaskOf(fixture.dataRoot, fixture.parent.key).state).toBe("landed");
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

  it("gives the clone the git identity of GIT_TEST_IDENTITY through vcs.config", async () => {
    const work = await useWorkReviewTask({ repo: { updateBranchStrategy: "merge" } });

    const read = async (key: string) =>
      (await runGit(["config", "--local", "--get", key], { gitDir: work.clone, env: work.env })).trim();

    expect(await read("user.name")).toBe(GIT_TEST_IDENTITY.name);
    expect(await read("user.email")).toBe(GIT_TEST_IDENTITY.email);
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

describe("useStartFixture with ghAnswers", () => {
  it("adds the answers after the token and issue answers", async () => {
    const answer = githubWriteAnswer({
      project: "codeguru42/tasker",
      number: 5,
      verb: "edit",
      rest: ["--add-assignee", "@me"],
    });
    const fixture = await useStartFixture({ ghAnswers: [answer] });
    const result = spawnSync("gh", [...answer.args], { env: fixture.gh.env, encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(trackerWriteCalls(fixture.gh)).toEqual([[...answer.args]]);
  });
});

describe("trackerRepo", () => {
  it("gives the github provider and the account, then the keys", () => {
    expect(trackerRepo({ updateOnStart: true, assignee: "bob" })).toEqual({
      issueTracker: { provider: "github", account: "codeguru42", updateOnStart: true, assignee: "bob" },
    });
  });

  it("lets a key replace the account", () => {
    expect(trackerRepo({ account: "other" }).issueTracker.account).toBe("other");
  });

  it("reaches the configuration through useStartFixture", async () => {
    const fixture = await useStartFixture({ repo: trackerRepo({ updateOnStart: true, inProgressLabel: "wip" }) });

    expect(fixture.config.repos[fixture.repoKey].issueTracker).toMatchObject({
      provider: "github",
      updateOnStart: true,
      inProgressLabel: "wip",
    });
  });
});

describe("useMovedBaseTask", () => {
  it("moves main on origin past the task branch and gives the new tip", async () => {
    const work = await useMovedBaseTask();

    expect(await work.origin.branchHead("main")).toBe(work.baseTip);
    const contains = await runGit(["merge-base", "--is-ancestor", work.baseTip, String(work.task.branch)], {
      gitDir: work.clone,
      env: work.env,
    }).then(
      () => true,
      () => false,
    );
    expect(contains).toBe(false);
    expect(work.task.state).toBe("awaiting_work_review");
  });

  it("passes the options to useWorkReviewTask and the change to the commit on main", async () => {
    const work = await useMovedBaseTask({ files: [], baseChange: { file: "moved.txt", content: "moved\n" } });

    expect(await work.origin.branchHead("main")).toBe(work.baseTip);
    const files = await runGit(["show", "--name-only", "--format=", work.baseTip], {
      gitDir: work.origin.path,
      env: work.env,
    });
    expect(files.trim()).toBe("moved.txt");
  });
});
