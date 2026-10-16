import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finish } from "../../src/commands/finish.js";
import { bootstrapLogPath } from "../../src/phases/bootstrap.js";
import { canonicalPath } from "../../src/real-path.js";
import { taskLogsDir } from "../../src/store/layout.js";
import { taskLockName } from "../../src/store/locks.js";
import { removeTaskWorktree } from "../../src/vcs/git/worktree.js";
import { runCommand } from "../helpers/cli.js";
import { githubWriteAnswer, trackerWriteCalls } from "../helpers/fake-gh.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  dayAt,
  eventDataOf,
  eventsOf,
  lastErrorOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  seedTasks,
  withDataRootStore,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  moveTaskThrough,
  trackerRepo,
  taskWorkspaceState,
  useAcceptedTask,
  useLandedTask,
  useStartFixture,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

const runFinish = () => runCommand(finish, "finish", KEY, "--repo", REPO);

const refusal = (state: string) => `the task of ${KEY} is in ${state}; tasker finish needs landed or cleanup_failed\n`;

describe("finish", () => {
  it("refuses a task in accepted and keeps the worktree and the branch", async () => {
    const accepted = await useAcceptedTask();
    const workspace = {
      ...accepted,
      worktree: String(accepted.task.worktreePath),
      branch: String(accepted.task.branch),
    };
    const before = await taskWorkspaceState(workspace);

    await expectCommandRefused({ dataRoot: accepted.dataRoot, key: KEY }, runFinish, refusal("accepted"));

    expect(await taskWorkspaceState(workspace)).toEqual(before);
  });

  it("refuses a task in finished", async () => {
    const fixture = await useStartFixture();
    seedTasks(fixture.dataRoot, [{ issueKey: KEY, repoKey: REPO, state: "finished", at: dayAt(1) }]);

    await expectCommandRefused({ dataRoot: fixture.dataRoot, key: KEY }, runFinish, refusal("finished"));
  });

  it("refuses at once when another process holds the task lock", async () => {
    const landed = await useLandedTask();
    const before = await taskWorkspaceState(landed);
    const name = taskLockName(REPO, KEY);
    const holder = startLockHolder(databasePathOf(landed.dataRoot), name);
    await holder.attempt;

    await expectCommandRefused(
      { dataRoot: landed.dataRoot, key: KEY },
      runFinish,
      new RegExp(`^the lock ${name} is busy`),
    );

    expect(await taskWorkspaceState(landed)).toEqual(before);
  });

  it("finishes a landed task", async () => {
    const landed = await useLandedTask();
    const { dataRoot, task, worktree, branch } = landed;
    const landedEvents = eventsOf(dataRoot, KEY).length;

    const result = await runFinish();

    expect(result).toEqual({
      code: 0,
      out: `removed the worktree ${canonicalPath(worktree)}\ndeleted the branch ${branch}\nfinished ${KEY}\n`,
      err: "",
    });
    expect(await taskWorkspaceState(landed)).toEqual({
      state: "finished",
      worktree: false,
      listed: false,
      branch: false,
    });
    expect(eventsOf(dataRoot, KEY).slice(landedEvents)).toEqual([
      { type: "transition", data: { from: "landed", to: "finishing" } },
      {
        type: "transition",
        data: { worktree: "removed", branch: "deleted", from: "finishing", to: "finished" },
      },
    ]);
    expect(readRunMarker(databasePathOf(dataRoot), task.id)).toBeUndefined();
    expect(lockNames(dataRoot)).toEqual([]);
    expect(existsSync(bootstrapLogPath(taskLogsDir(dataRoot, latestTaskOf(dataRoot, KEY))))).toBe(true);
  });

  it("finishes the steps that are left from cleanup_failed", async () => {
    const landed = await useLandedTask();
    const { dataRoot, task, worktree, branch } = landed;
    await removeTaskWorktree({ clone: landed.clone, env: landed.env, path: worktree });
    withDataRootStore(dataRoot, (store) => moveTaskThrough(store, task.id, ["finishing", "cleanup_failed"]));

    const result = await runFinish();

    expect(result).toEqual({ code: 0, out: `deleted the branch ${branch}\nfinished ${KEY}\n`, err: "" });
    expect(eventsOf(dataRoot, KEY).at(-1)?.data).toEqual({
      worktree: "already gone",
      branch: "deleted",
      from: "finishing",
      to: "finished",
    });
    expect((await taskWorkspaceState(landed)).state).toBe("finished");
  });

  describe("with an untracked file in the worktree", () => {
    it("moves the task to cleanup_failed when git refuses the remove", async () => {
      const landed = await useLandedTask();
      const { dataRoot, task, worktree } = landed;
      writeFileSync(join(worktree, "dirty.txt"), "dirty\n");

      const result = await runFinish();

      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toMatch(/^finishing failed: git.*\n$/s);
      const error = result.err.slice(0, -1);
      expect(lastErrorOf(dataRoot, task.id)).toBe(error);
      expect(eventsOf(dataRoot, KEY).at(-1)?.data).toEqual({ error, from: "finishing", to: "cleanup_failed" });
      expect(await taskWorkspaceState(landed)).toEqual({
        state: "cleanup_failed",
        worktree: true,
        listed: true,
        branch: true,
      });
      expect(readRunMarker(databasePathOf(dataRoot), task.id)).toBeUndefined();
    });

    it("finishes from cleanup_failed after the fix", async () => {
      const landed = await useLandedTask();
      const file = join(landed.worktree, "dirty.txt");
      writeFileSync(file, "dirty\n");
      expect((await runFinish()).code).toBe(1);
      rmSync(file);

      const result = await runFinish();

      expect(result.code).toBe(0);
      expect(await taskWorkspaceState(landed)).toEqual({
        state: "finished",
        worktree: false,
        listed: false,
        branch: false,
      });
    });
  });
});

describe("finish with the tracker write", () => {
  const LABEL_CALL = ["issue", "edit", "5", "-R", REPO, "--add-label", "done"];
  const CLOSE_CALL = ["issue", "close", "5", "-R", REPO, "--reason", "completed"];
  const labelAnswer = (failure: { stderr: string; exitCode: number } | object = {}) =>
    githubWriteAnswer({ project: REPO, number: 5, verb: "edit", rest: ["--add-label", "done"], ...failure });

  it("adds the done label after the cleanup and before the move to finished", async () => {
    const landed = await useLandedTask({
      repo: trackerRepo({ updateOnFinish: true, doneLabel: "done" }),
      ghAnswers: [labelAnswer()],
    });
    const { dataRoot, worktree, branch } = landed;

    const result = await runFinish();

    expect(result).toEqual({
      code: 0,
      out:
        `removed the worktree ${canonicalPath(worktree)}\ndeleted the branch ${branch}\n` +
        `marked ${KEY} done on the tracker\nfinished ${KEY}\n`,
      err: "",
    });
    expect(trackerWriteCalls(landed.gh)).toEqual([LABEL_CALL]);
    const events = eventsOf(dataRoot, KEY);
    expect(events.at(-2)).toEqual({ type: "tracker_update", data: { action: "done", result: "ok" } });
    expect(events.at(-1)?.data).toMatchObject({ from: "finishing", to: "finished" });
  });

  it("closes the issue as completed when there is no done label", async () => {
    const landed = await useLandedTask({
      repo: trackerRepo({ updateOnFinish: true }),
      ghAnswers: [githubWriteAnswer({ project: REPO, number: 5, verb: "close", rest: ["--reason", "completed"] })],
    });

    const result = await runFinish();

    expect(result.code).toBe(0);
    expect(result.out).toContain(`marked ${KEY} done on the tracker\n`);
    expect(trackerWriteCalls(landed.gh)).toEqual([CLOSE_CALL]);
  });

  it("warns for a failed write, exits with 0 and still finishes the task", async () => {
    const landed = await useLandedTask({
      repo: trackerRepo({ updateOnFinish: true, doneLabel: "done" }),
      ghAnswers: [labelAnswer({ stderr: "cannot label\n", exitCode: 1 })],
    });

    const result = await runFinish();

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("on the tracker");
    expect(result.out.endsWith(`finished ${KEY}\n`)).toBe(true);
    const [event] = eventDataOf(landed.dataRoot, KEY, "tracker_update") as {
      action: string;
      result: string;
      error: string;
    }[];
    expect(event).toEqual({ action: "done", result: "failed", error: expect.stringContaining("cannot label") });
    expect(result.err).toBe(`warning: cannot mark ${KEY} done on the tracker: ${event.error}\n`);
    expect(latestTaskOf(landed.dataRoot, KEY).state).toBe("finished");
    expect(trackerWriteCalls(landed.gh)).toEqual([LABEL_CALL]);
  });

  it("makes no write and no event when updateOnFinish is false", async () => {
    const landed = await useLandedTask({ repo: trackerRepo({ updateOnFinish: false, doneLabel: "done" }) });

    const result = await runFinish();

    expect(result.code).toBe(0);
    expect(trackerWriteCalls(landed.gh)).toEqual([]);
    expect(eventDataOf(landed.dataRoot, KEY, "tracker_update")).toEqual([]);
  });
});
