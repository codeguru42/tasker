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
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  dayAt,
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
    const before = await taskWorkspaceState(accepted);

    await expectCommandRefused({ dataRoot: accepted.dataRoot, key: KEY }, runFinish, refusal("accepted"));

    expect(await taskWorkspaceState(accepted)).toEqual(before);
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
