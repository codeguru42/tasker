import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { show } from "../../src/commands/show.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { issueKeyErrorMessage, useThreeRepoDataRoot } from "../helpers/config.js";
import { taskNames } from "../helpers/git.js";
import {
  planTodo,
  seedExecuteFixTurn,
  seedExecuteTodoStates,
  seedPinnedPlanRevision,
  seedPlanRevision,
  validPlanAnswer,
} from "../helpers/plan.js";
import { deadRunNote, expectedShowLines } from "../helpers/state-commands.js";
import { findingText, reviewFinding } from "../helpers/review.js";
import {
  dayAt,
  pauseTaskFrom,
  seedDeadRun,
  seedReview,
  seedTaskWithReviews,
  seedTasks,
  withDataRootStore,
} from "../helpers/store.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import type { PlanAnswer } from "../../src/plan/answer.js";
import {
  transitionTask,
  transitionWithBranchUpdate,
  type TaskState,
  type TransitionDetail,
} from "../../src/state/machine.js";
import type { ExecuteTodoState, Task } from "../../src/store/store.js";

const TASKER = "codeguru42/tasker";
const OTHER = "codeguru42/other";

const runShow = (...args: string[]) => runCommand(show, "show", ...args);

// The clone: line of tasker show for the repo repoKey under dataRoot.
const cloneLine = (dataRoot: string, repoKey: string) => `clone: ${repoPaths(dataRoot, repoKey).clone}\n`;

// The fields of the task that seedPinnedTask seeds in the state executed, with the fixed clock of the seed.
const executedFields = (dataRoot: string): string =>
  "issue: codeguru42/tasker#5\n" +
  "repo: codeguru42/tasker\n" +
  "title: -\n" +
  "state: executed\n" +
  "attempt: 1\n" +
  "base: -\n" +
  "branch: -\n" +
  "worktree: -\n" +
  cloneLine(dataRoot, TASKER) +
  "created: 2026-01-04T00:00:00.000Z\n" +
  "updated: 2026-01-04T00:00:00.000Z\n" +
  'last event: 2026-01-04T00:00:00.000Z plan_revision {"version":1,"prompt":"plan@000000000000"}\n';

const EXECUTED_COMMANDS = expectedShowLines("executed", "codeguru42/tasker#5");

const PADDED_BLOCK =
  "todos (approved v1):\n" +
  "  done         write-test    Add the a module\n" +
  "  not started  make-it-pass  Add the a module\n";

// The text after the last event: line of the output of tasker show.
function afterLastEvent(out: string): string {
  const lines = out.split("\n");
  return lines.slice(lines.findIndex((line) => line.startsWith("last event:")) + 1).join("\n");
}

// Seeds the task codeguru42/tasker#5 in workspace_ready, then pauses it in pause from origin with a real move.
function seedPausedTask(
  dataRoot: string,
  origin: TaskState,
  pause: "quota_blocked" | "awaiting_quota_approval" | "interrupted",
  data?: TransitionDetail,
): Task {
  const [task] = seedTasks(dataRoot, [
    { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "workspace_ready", at: dayAt(2) },
  ]);
  return withDataRootStore(dataRoot, (store) => pauseTaskFrom(store, task.id, origin, pause, data));
}

// Seeds the task codeguru42/tasker#5 in executed (or failed, with failWith) and its pinned revision v1.
// The clock is fixed, so that the time fields do not change.
function seedPinnedTask(
  dataRoot: string,
  o: {
    failWith?: string;
    answer?: PlanAnswer;
    todoStates?: Record<string, ExecuteTodoState>;
    fixTurn?: "queued" | "done";
    reviewed?: boolean;
  },
): void {
  const [task] = seedTasks(dataRoot, [
    {
      issueKey: `${TASKER}#5`,
      repoKey: TASKER,
      state: o.failWith === undefined ? "executed" : "executing",
      at: dayAt(4),
      failWith: o.failWith,
    },
  ]);
  withDataRootStore(
    dataRoot,
    (store) => {
      seedPinnedPlanRevision(store, task.id, o.answer === undefined ? {} : { answer: o.answer }, task.state);
      seedExecuteTodoStates(store, task.id, 1, o.todoStates ?? {});
      if (o.fixTurn !== undefined) seedExecuteFixTurn(store, task.id, 1, o.fixTurn);
      if (o.reviewed) seedReview(store, task.id);
    },
    { now: () => new Date(dayAt(4)) },
  );
}

describe("show", () => {
  it("prints the fields of a task in workspace_ready", async () => {
    const names = taskNames("/tmp/wt", 5, "Add tasker show");
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      {
        issueKey: `${TASKER}#5`,
        repoKey: TASKER,
        state: "workspace_ready",
        at: dayAt(2),
        title: "Add tasker show",
        base: "main",
        branch: names.branch,
        worktreePath: names.worktree,
      },
    ]);

    const result = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "issue: codeguru42/tasker#5\n" +
        "repo: codeguru42/tasker\n" +
        "title: Add tasker show\n" +
        "state: workspace_ready\n" +
        "attempt: 1\n" +
        "base: main\n" +
        `branch: ${names.branch}\n` +
        `worktree: ${names.worktree}\n` +
        cloneLine(dataRoot, TASKER) +
        "created: 2026-01-02T00:00:00.000Z\n" +
        "updated: 2026-01-02T00:00:00.000Z\n" +
        'last event: 2026-01-02T00:00:00.000Z created {"state":"workspace_ready"}\n' +
        expectedShowLines("workspace_ready", `${TASKER}#5`),
    });
  });

  it("prints the synced base tip after the base", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [{ issueKey: `${TASKER}#5`, repoKey: TASKER, state: "executed", at: dayAt(2) }]);
    const tip = "c".repeat(40);
    withDataRootStore(dataRoot, (store) => store.updateTask(task.id, { syncedBaseTip: tip }));

    const result = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(result.out).toContain(`base: -\nsynced base tip: ${tip}\nbranch: -\n`);
  });

  it("prints no synced base tip for a task with none", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [{ issueKey: `${TASKER}#5`, repoKey: TASKER, state: "executed", at: dayAt(2) }]);

    const result = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(result.out).not.toContain("synced base tip");
  });

  it("moves a task with a dead run to interrupted, prints it and writes the note on stderr", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [{ issueKey: `${TASKER}#5`, repoKey: TASKER, state: "approved", at: dayAt(2) }]);
    seedDeadRun(dataRoot, task.id, "executing");

    const result = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(result.code).toBe(0);
    expect(result.out).toContain("state: interrupted\n");
    expect(result.err).toBe(`${deadRunNote(`${TASKER}#5`, "executing")}\n`);
  });

  it("prints the active task of an issue that also has a cancelled task", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "cancelled", at: dayAt(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: dayAt(3) },
    ]);

    const result = await runShow(`${OTHER}#7`);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "issue: codeguru42/other#7\n" +
        "repo: codeguru42/other\n" +
        "title: -\n" +
        "state: executing\n" +
        "attempt: 2\n" +
        "base: -\n" +
        "branch: -\n" +
        "worktree: -\n" +
        cloneLine(dataRoot, OTHER) +
        "created: 2026-01-03T00:00:00.000Z\n" +
        "updated: 2026-01-03T00:00:00.000Z\n" +
        'last event: 2026-01-03T00:00:00.000Z created {"state":"executing"}\n' +
        expectedShowLines("executing", `${OTHER}#7`),
    });
  });

  it("prints the clone of the repo of the task for a finished task", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [{ issueKey: `${OTHER}#7`, repoKey: OTHER, state: "finished", at: dayAt(2) }]);

    const { code, out } = await runShow(`${OTHER}#7`, "--repo", OTHER);

    expect(code).toBe(0);
    expect(out).toContain("worktree: -\n" + cloneLine(dataRoot, OTHER));
  });

  it("prints the commands of a task in awaiting_work_review", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [{ issueKey: `${TASKER}#5`, repoKey: TASKER, state: "awaiting_work_review", at: dayAt(2) }]);

    const { code, out } = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(code).toBe(0);
    expect(out.endsWith(expectedShowLines("awaiting_work_review", `${TASKER}#5`))).toBe(true);
    expect(out).toContain(
      "commands: tasker review codeguru42/tasker#5, tasker accept codeguru42/tasker#5, tasker update-branch codeguru42/tasker#5, tasker abort codeguru42/tasker#5\n",
    );
  });

  it("prints no command line for a cancelled task", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [{ issueKey: `${TASKER}#5`, repoKey: TASKER, state: "cancelled", at: dayAt(2) }]);

    const { code, out } = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(code).toBe(0);
    expect(out).not.toMatch(/^(next|also|commands):/m);
    expect(out.trimEnd().split("\n").at(-1)).toMatch(/^last event:/);
  });

  it("prints an error for an issue with no task", async () => {
    useThreeRepoDataRoot();

    const result = await runShow(`${OTHER}#9`);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: "no task for the issue codeguru42/other#9 in the repo codeguru42/other\n",
    });
  });

  it.each(["nobody/else#1", `${TASKER}#5`])("prints the error of the issue key %s and opens no store", async (key) => {
    const written = useThreeRepoDataRoot();
    const expected = `${issueKeyErrorMessage(key, written.path)}\n`;

    const result = await runShow(key);

    expect(result).toEqual({ code: 1, out: "", err: expected });
    expect(existsSync(join(written.dataRoot, "tasker.db"))).toBe(false);
  });

  it("passes --repo to the issue key, so that it picks one of two repos", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: dayAt(2) },
      { issueKey: `${TASKER}#5`, repoKey: "fork", state: "planning", at: dayAt(3) },
    ]);

    const result = await runShow(`${TASKER}#5`, "--repo", "fork");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "issue: codeguru42/tasker#5\n" +
        "repo: fork\n" +
        "title: -\n" +
        "state: planning\n" +
        "attempt: 2\n" +
        "base: -\n" +
        "branch: -\n" +
        "worktree: -\n" +
        cloneLine(dataRoot, "fork") +
        "created: 2026-01-03T00:00:00.000Z\n" +
        "updated: 2026-01-03T00:00:00.000Z\n" +
        'last event: 2026-01-03T00:00:00.000Z created {"state":"planning"}\n' +
        expectedShowLines("planning", `${TASKER}#5`),
    });
  });

  it("prints the failure of a failed task", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      {
        issueKey: `${TASKER}#5`,
        repoKey: TASKER,
        state: "executing",
        at: dayAt(4),
        failWith: "git push failed",
      },
    ]);

    const result = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "issue: codeguru42/tasker#5\n" +
        "repo: codeguru42/tasker\n" +
        "title: -\n" +
        "state: failed\n" +
        "attempt: 1\n" +
        "base: -\n" +
        "branch: -\n" +
        "worktree: -\n" +
        cloneLine(dataRoot, TASKER) +
        "created: 2026-01-04T00:00:00.000Z\n" +
        "updated: 2026-01-04T00:00:00.000Z\n" +
        'last event: 2026-01-04T00:00:00.000Z transition {"error":"git push failed","from":"executing","to":"failed"}\n' +
        "failed in: executing\n" +
        "error: git push failed\n" +
        expectedShowLines("failed", `${TASKER}#5`),
    });
  });

  it("prints the error of a failed task that went through updating_branch and back to failed", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "executing", at: dayAt(4), failWith: "git push failed" },
    ]);
    const head = { head: "a".repeat(40), base: "main", baseRevision: "refs/remotes/origin/main", syncedBaseTip: null };
    withDataRootStore(dataRoot, (store) => {
      transitionTask(store, task.id, "updating_branch");
      transitionWithBranchUpdate(
        store,
        task.id,
        "failed",
        { before: head, after: head, how: "none", sync: "none" },
        {},
      );
    });

    const result = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(result.out).toContain("state: failed\n");
    expect(result.out).toContain("failed in: executing\n");
    expect(result.out).toContain("error: git push failed\n");
  });

  it("prints each line end in a value as the two characters \\n", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      {
        issueKey: `${TASKER}#5`,
        repoKey: TASKER,
        state: "executing",
        at: dayAt(4),
        failWith: "git push failed\r\nexit 128\rdone\nend",
      },
    ]);

    const result = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "issue: codeguru42/tasker#5\n" +
        "repo: codeguru42/tasker\n" +
        "title: -\n" +
        "state: failed\n" +
        "attempt: 1\n" +
        "base: -\n" +
        "branch: -\n" +
        "worktree: -\n" +
        cloneLine(dataRoot, TASKER) +
        "created: 2026-01-04T00:00:00.000Z\n" +
        "updated: 2026-01-04T00:00:00.000Z\n" +
        'last event: 2026-01-04T00:00:00.000Z transition {"error":"git push failed\\r\\nexit 128\\rdone\\nend","from":"executing","to":"failed"}\n' +
        "failed in: executing\n" +
        "error: git push failed\\nexit 128\\ndone\\nend\n" +
        expectedShowLines("failed", `${TASKER}#5`),
    });
  });

  it("prints no todo block for a task with no pinned revision", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [{ issueKey: `${TASKER}#5`, repoKey: TASKER, state: "executed", at: dayAt(4) }]);
    withDataRootStore(
      dataRoot,
      (store) => {
        seedPlanRevision(store, task.id, {}, "executed");
        seedExecuteTodoStates(store, task.id, 1, { "write-test": "done" });
      },
      { now: () => new Date(dayAt(4)) },
    );

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out: executedFields(dataRoot) + EXECUTED_COMMANDS,
    });
  });

  it("prints no todo block when no todo of the pinned revision has a recorded state", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, {});

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out: executedFields(dataRoot) + EXECUTED_COMMANDS,
    });
  });

  it("pads the state and the id of each todo to the longest value", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, { todoStates: { "write-test": "done" } });

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out: executedFields(dataRoot) + EXECUTED_COMMANDS + PADDED_BLOCK,
    });
  });

  it("prints the state in progress", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, { todoStates: { "make-it-pass": "in_progress" } });

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out:
        executedFields(dataRoot) +
        EXECUTED_COMMANDS +
        "todos (approved v1):\n" +
        "  not started  write-test    Add the a module\n" +
        "  in progress  make-it-pass  Add the a module\n",
    });
  });

  it("prints each line end in a todo title as the two characters \\n", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, {
      answer: validPlanAnswer({ todos: [planTodo("a", [], { title: "First line\nsecond line" })] }),
      todoStates: { a: "done" },
    });

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out: executedFields(dataRoot) + EXECUTED_COMMANDS + "todos (approved v1):\n  done  a  First line\\nsecond line\n",
    });
  });

  it("prints the todo block after the failed in and error lines", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, { failWith: "git push failed", todoStates: { "write-test": "done" } });

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out:
        executedFields(dataRoot).replace("state: executed", "state: failed") +
        "failed in: executing\n" +
        "error: git push failed\n" +
        expectedShowLines("failed", `${TASKER}#5`) +
        PADDED_BLOCK,
    });
  });

  it.each(["queued", "done"] as const)("prints the line fix turn: %s after the todo block", async (fixTurn) => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, { todoStates: { "write-test": "done" }, fixTurn });

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out: executedFields(dataRoot) + EXECUTED_COMMANDS + PADDED_BLOCK + `fix turn: ${fixTurn}\n`,
    });
  });

  it("prints the findings of the latest review after the fields of a reviewed task", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTaskWithReviews(
      dataRoot,
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "awaiting_work_review", at: dayAt(2) },
      [{}, { revision: "abc123def456", findings: [reviewFinding()] }],
    );

    const { code, err, out } = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(afterLastEvent(out)).toBe(
      expectedShowLines("reviewed", `${TASKER}#5`) +
        "review findings (review 2, at abc123def456):\n" +
        findingText("first", 1),
    );
  });

  it.each([
    {
      pause: "quota_blocked",
      origin: "executing",
      data: { cause: "rate_limit", resetsAt: 1792206000 },
      lines: "paused from: executing\ncause: rate_limit\nresets at: 2026-10-17T03:00:00.000Z\n",
    },
    {
      pause: "quota_blocked",
      origin: "planning",
      data: { cause: "overage" },
      lines: "paused from: planning\ncause: overage\nresets at: -\n",
    },
    {
      pause: "awaiting_quota_approval",
      origin: "planning",
      data: { utilization: 0.95, resetsAt: 1792206000 },
      lines: "paused from: planning\nutilization: 0.95\nresets at: 2026-10-17T03:00:00.000Z\n",
    },
    {
      pause: "awaiting_quota_approval",
      origin: "executing",
      data: undefined,
      lines: "paused from: executing\nutilization: 0.95\nresets at: -\n",
    },
    {
      pause: "interrupted",
      origin: "verifying",
      data: undefined,
      lines: "paused from: verifying\ncause: dead_run\n",
    },
    {
      pause: "interrupted",
      origin: "executing",
      data: { cause: "signal", signal: "SIGTERM" },
      lines: "paused from: executing\ncause: signal SIGTERM\n",
    },
  ] as const)("prints the facts of a task in $pause from $origin", async ({ pause, origin, data, lines }) => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPausedTask(dataRoot, origin, pause, data);

    const { code, err, out } = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(afterLastEvent(out)).toBe(lines + expectedShowLines(pause, `${TASKER}#5`));
  });

  it("prints no fact of a pause for a task in another state with a pause in its past", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const task = seedPausedTask(dataRoot, "executing", "quota_blocked", { cause: "rate_limit", resetsAt: 1792206000 });
    withDataRootStore(dataRoot, (store) => store.updateTask(task.id, { state: "approved" }));

    const { code, out } = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(code).toBe(0);
    expect(out).not.toMatch(/^(paused from|cause|utilization|resets at):/m);
  });

  it("prints - for each fact of a task in quota_blocked with no move into it", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [{ issueKey: `${TASKER}#5`, repoKey: TASKER, state: "quota_blocked", at: dayAt(2) }]);

    const { code, err, out } = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(afterLastEvent(out)).toBe(
      "paused from: -\ncause: -\nresets at: -\n" + expectedShowLines("quota_blocked", `${TASKER}#5`),
    );
  });

  it("prints no findings of a review for a task that is not reviewed", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTaskWithReviews(
      dataRoot,
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "awaiting_work_review", at: dayAt(2) },
      [{}],
      "awaiting_work_review",
    );

    const { code, out } = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(code).toBe(0);
    expect(out).not.toContain("review findings");
    expect(out.endsWith(expectedShowLines("awaiting_work_review", `${TASKER}#5`))).toBe(true);
  });

  it("prints the findings of a reviewed task after the todo block", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, { todoStates: { "write-test": "done" }, reviewed: true });

    const { code, err, out } = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(
      out.endsWith(
        PADDED_BLOCK +
          "review findings (review 1, at 4b825dc642cb):\n" +
          findingText("first", 1) +
          findingText("second", 2),
      ),
    ).toBe(true);
  });

  it("prints the description of the command and of --repo for --help", async () => {
    const { code, help } = await runHelp(show, "show");

    expect(code).toBe(0);
    expect(help).toContain("Print the details of the task of an issue: the active task, else the newest one");
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
