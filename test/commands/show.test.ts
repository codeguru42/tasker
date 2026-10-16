import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { show } from "../../src/commands/show.js";
import { runCommand } from "../helpers/cli.js";
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
import { reviewFinding } from "../helpers/review.js";
import { dayAt, seedReview, seedTasks, withDataRootStore } from "../helpers/store.js";
import type { PlanAnswer } from "../../src/plan/answer.js";
import type { ExecuteTodoState } from "../../src/store/store.js";

const TASKER = "codeguru42/tasker";
const OTHER = "codeguru42/other";

const runShow = (...args: string[]) => runCommand(show, "show", ...args);

// The fields of the task that seedPinnedTask seeds in the state executed, with the fixed clock of the seed.
const EXECUTED_FIELDS =
  "issue: codeguru42/tasker#5\n" +
  "repo: codeguru42/tasker\n" +
  "title: -\n" +
  "state: executed\n" +
  "attempt: 1\n" +
  "base: -\n" +
  "branch: -\n" +
  "worktree: -\n" +
  "created: 2026-01-04T00:00:00.000Z\n" +
  "updated: 2026-01-04T00:00:00.000Z\n" +
  'last event: 2026-01-04T00:00:00.000Z plan_revision {"version":1,"prompt":"plan@000000000000"}\n';

const PADDED_BLOCK =
  "todos (approved v1):\n" +
  "  done         write-test    Add the a module\n" +
  "  not started  make-it-pass  Add the a module\n";

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
        "created: 2026-01-02T00:00:00.000Z\n" +
        "updated: 2026-01-02T00:00:00.000Z\n" +
        'last event: 2026-01-02T00:00:00.000Z created {"state":"workspace_ready"}\n',
    });
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
        "created: 2026-01-03T00:00:00.000Z\n" +
        "updated: 2026-01-03T00:00:00.000Z\n" +
        'last event: 2026-01-03T00:00:00.000Z created {"state":"executing"}\n',
    });
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
        "created: 2026-01-03T00:00:00.000Z\n" +
        "updated: 2026-01-03T00:00:00.000Z\n" +
        'last event: 2026-01-03T00:00:00.000Z created {"state":"planning"}\n',
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
        "created: 2026-01-04T00:00:00.000Z\n" +
        "updated: 2026-01-04T00:00:00.000Z\n" +
        'last event: 2026-01-04T00:00:00.000Z transition {"error":"git push failed","from":"executing","to":"failed"}\n' +
        "failed in: executing\n" +
        "error: git push failed\n",
    });
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
        "created: 2026-01-04T00:00:00.000Z\n" +
        "updated: 2026-01-04T00:00:00.000Z\n" +
        'last event: 2026-01-04T00:00:00.000Z transition {"error":"git push failed\\r\\nexit 128\\rdone\\nend","from":"executing","to":"failed"}\n' +
        "failed in: executing\n" +
        "error: git push failed\\nexit 128\\ndone\\nend\n",
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

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({ code: 0, err: "", out: EXECUTED_FIELDS });
  });

  it("prints no todo block when no todo of the pinned revision has a recorded state", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, {});

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({ code: 0, err: "", out: EXECUTED_FIELDS });
  });

  it("pads the state and the id of each todo to the longest value", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, { todoStates: { "write-test": "done" } });

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out: EXECUTED_FIELDS + PADDED_BLOCK,
    });
  });

  it("prints the state in progress", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, { todoStates: { "make-it-pass": "in_progress" } });

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out:
        EXECUTED_FIELDS +
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
      out: EXECUTED_FIELDS + "todos (approved v1):\n  done  a  First line\\nsecond line\n",
    });
  });

  it("prints the todo block after the failed in and error lines", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, { failWith: "git push failed", todoStates: { "write-test": "done" } });

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out:
        EXECUTED_FIELDS.replace("state: executed", "state: failed") +
        "failed in: executing\n" +
        "error: git push failed\n" +
        PADDED_BLOCK,
    });
  });

  it.each(["queued", "done"] as const)("prints the line fix turn: %s after the todo block", async (fixTurn) => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedPinnedTask(dataRoot, { todoStates: { "write-test": "done" }, fixTurn });

    expect(await runShow(`${TASKER}#5`, "--repo", TASKER)).toEqual({
      code: 0,
      err: "",
      out: EXECUTED_FIELDS + PADDED_BLOCK + `fix turn: ${fixTurn}\n`,
    });
  });

  it("prints the findings of the latest review after the fields of a reviewed task", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "awaiting_work_review", at: dayAt(2) },
    ]);
    withDataRootStore(dataRoot, (store) => {
      seedReview(store, task.id);
      seedReview(store, task.id, { revision: "abc123def456", findings: [reviewFinding()] });
    });

    const { code, err, out } = await runShow(`${TASKER}#5`, "--repo", TASKER);

    const lines = out.split("\n");
    const rest = lines.slice(lines.findIndex((line) => line.startsWith("last event:")) + 1).join("\n");
    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(rest).toBe(
      "review findings (review 2, at abc123def456):\n" +
        "- [1] src/a.ts:3 (correctness): The loop skips the last item.\n" +
        "  failure scenario: A list of two items gives only the first one.\n" +
        "  status: open\n",
    );
  });

  it("prints no findings of a review for a task that is not reviewed", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "awaiting_work_review", at: dayAt(2) },
    ]);
    withDataRootStore(dataRoot, (store) => seedReview(store, task.id, {}, "awaiting_work_review"));

    const { code, out } = await runShow(`${TASKER}#5`, "--repo", TASKER);

    expect(code).toBe(0);
    expect(out).not.toContain("review findings");
    expect(out.trimEnd().split("\n").at(-1)).toMatch(/^last event:/);
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
          "- [1] src/a.ts:3 (correctness): The loop skips the last item.\n" +
          "  failure scenario: A list of two items gives only the first one.\n" +
          "  status: open\n" +
          "- [2] src/b.ts:9 (correctness): The count is off by one.\n" +
          "  failure scenario: A list of three items gives the count 2.\n" +
          "  status: open\n",
      ),
    ).toBe(true);
  });

  it("prints the description of the command and of --repo for --help", async () => {
    const { code, out } = await runShow("--help");

    expect(code).toBe(0);
    // Commander wraps the long lines of the help, so compare with single spaces.
    const help = out.replace(/\s+/g, " ");
    expect(help).toContain("Print the details of the task of an issue: the active task, else the newest one");
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
