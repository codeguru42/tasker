import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import { transitionTask } from "../../src/state/machine.js";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import { createDataRoot } from "../../src/store/layout.js";
import { canonicalPath } from "../../src/real-path.js";
import { abortTask } from "../../src/tasks/abort.js";
import { startTask } from "../../src/tasks/start.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { listWorktrees } from "../../src/vcs/git/worktree.js";
import { startLockHolder } from "../helpers/processes.js";
import { databasePathOf, latestTaskOf, lockNames, readRunMarker, withDataRootStore } from "../helpers/store.js";
import { taskWorkspaceState, useStartFixture, useStartedTask } from "../helpers/task-fixtures.js";
import { useTempDir } from "../helpers/temp.js";

describe("abortTask", () => {
  it("removes the worktree when the data root goes through a symlink", async () => {
    const fixture = await useStartFixture();
    const dataRoot = join(useTempDir("tasker-link-"), "link");
    symlinkSync(useTempDir("tasker-real-"), dataRoot);
    const config = { ...fixture.config, dataRoot };
    const ref = { key: "codeguru42/tasker#5", repoKey: fixture.repoKey, shortRef: githubShortRef("5") };

    const task = await withDataRootStore(dataRoot, async (store) => {
      const started = await startTask(store, {
        config,
        ref,
        env: process.env,
        repoLockWaitMs: 300,
        ask: () => Promise.reject(new Error("no question expected")),
        note: () => {},
        reclaim: false,
        trackerIo: { stdout: () => {}, stderr: () => {} },
      });
      const worktree = started.task.worktreePath!;
      const cancelled = await abortTask(store, {
        config,
        ref,
        taskId: started.task.id,
        force: false,
        env: process.env,
        repoLockWaitMs: 300,
        report: () => {},
        trackerIo: { stdout: () => {}, stderr: () => {} },
      });
      return { cancelled, worktree };
    });

    const entries = await listWorktrees({
      clone: repoPaths(dataRoot, fixture.repoKey).clone,
      env: fixture.origin.env,
    });
    expect(entries.map((entry) => entry.path)).not.toContain(canonicalPath(task.worktree));
    expect(task.cancelled.state).toBe("cancelled");
  });

  it("refuses a task with a run in progress and leaves everything", async () => {
    const started = await useStartedTask();
    const taskId = latestTaskOf(started.dataRoot, started.key).id;
    withDataRootStore(started.dataRoot, (store) => transitionTask(store, taskId, "planning"));
    const before = await taskWorkspaceState(started);
    const marker = readRunMarker(databasePathOf(started.dataRoot), taskId);
    const ref = { key: started.key, repoKey: started.repoKey, shortRef: githubShortRef("5") };

    const error = await withDataRootStore(started.dataRoot, (store) =>
      abortTask(store, {
        config: started.config,
        ref,
        taskId,
        force: false,
        env: process.env,
        repoLockWaitMs: 300,
        report: () => {},
        trackerIo: { stdout: () => {}, stderr: () => {} },
      }).catch((caught: unknown) => caught),
    );

    expect((error as Error).message).toBe(
      `the task of ${started.key} has a run in progress in planning (tasker process ${process.pid}); wait for it, or stop that process`,
    );
    expect(latestTaskOf(started.dataRoot, started.key).state).toBe("planning");
    expect(readRunMarker(databasePathOf(started.dataRoot), taskId)).toEqual(marker);
    expect((await taskWorkspaceState(started)).listed).toBe(before.listed);
    expect(lockNames(started.dataRoot)).toEqual([]);
  });

  it("leaves everything and releases the task lock when the repo lock is busy", async () => {
    const started = await useStartedTask();
    const before = await taskWorkspaceState(started);
    const holder = startLockHolder(createDataRoot(started.dataRoot).database, repoLockName(started.repoKey));
    await holder.attempt;
    const ref = { key: started.key, repoKey: started.repoKey, shortRef: githubShortRef("5") };

    const error = await withDataRootStore(started.dataRoot, (store) =>
      abortTask(store, {
        config: started.config,
        ref,
        taskId: store.findLatestTask(started.repoKey, started.key)!.id,
        force: false,
        env: process.env,
        repoLockWaitMs: 300,
        report: () => {},
        trackerIo: { stdout: () => {}, stderr: () => {} },
      }).catch((caught: unknown) => caught),
    );

    expect(error).toBeInstanceOf(LockBusyError);
    expect((error as Error).message).toContain("the lock repo:codeguru42/tasker is busy");
    expect(await taskWorkspaceState(started)).toEqual(before);
    expect(lockNames(started.dataRoot)).toEqual([repoLockName(started.repoKey)]);
  });
});
