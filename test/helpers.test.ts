import { existsSync, readFileSync, rmSync } from "node:fs";
import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import { issueProviderFor } from "../src/issues/provider.js";
import { checkPlanAnswer } from "../src/plan/answer.js";
import { type Task, type TaskStore } from "../src/store/store.js";
import { dataRootLayout, planRevisionPath } from "../src/store/layout.js";
import { changedPaths } from "../src/vcs/git/changes.js";
import { repoPaths } from "../src/vcs/git/repo-paths.js";
import {
  dayAt,
  localBranches,
  readRunMarker,
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
  useTempDir,
  useAssistantRunFixture,
  useStartedTask,
  useStartFixture,
  validPlanAnswer,
  withDataRootStore,
  planAnswerStream,
  usePlanFixture,
} from "./helpers.js";

// Creates the task a/b#1 in the planning state, the task that the store tests of the helpers use.
function seedTask(store: TaskStore): Task {
  return store.createTask({ issueKey: "a/b#1", repoKey: "a/b", state: "planning" });
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
