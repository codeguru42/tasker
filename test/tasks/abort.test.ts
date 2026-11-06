import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import { transitionTask } from "../../src/state/machine.js";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import type { Task, TaskStore } from "../../src/store/store.js";
import { createDataRoot } from "../../src/store/layout.js";
import { canonicalPath } from "../../src/real-path.js";
import { abortTask, type AbortRequest } from "../../src/tasks/abort.js";
import { startTask } from "../../src/tasks/start.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { listWorktrees } from "../../src/vcs/git/worktree.js";
import { AUTH_STATUS_ARGS, fakeAcli, jiraRefOf, MEASURED_AUTH_STATUS } from "../helpers/fake-acli.js";
import { copyCloneBranchToOrigin } from "../helpers/git.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventDataOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  withDataRootStore,
} from "../helpers/store.js";
import {
  taskRefOf,
  taskWorkspaceState,
  usePublishedStartedTask,
  useStartFixture,
  useStartedTask,
  type StartedTask,
} from "../helpers/task-fixtures.js";
import { useTempDir } from "../helpers/temp.js";

// Calls abortTask() with the defaults of a test. The values of request win.
function abortWith(
  store: TaskStore,
  request: Pick<AbortRequest, "config" | "ref" | "taskId"> & Partial<AbortRequest>,
): Promise<Task> {
  return abortTask(store, {
    force: false,
    env: process.env,
    repoLockWaitMs: 300,
    report: () => {},
    trackerIo: { stdout: () => {}, stderr: () => {} },
    ...request,
  });
}

// Aborts a new task TEST-5 of a Jira repo. options.keys add to the keys of issueTracker.
async function abortJiraTask(
  started: StartedTask,
  options: { keys?: Record<string, unknown>; env?: NodeJS.ProcessEnv; marked?: boolean } = {},
): Promise<{ cancelled: Task; lines: string[] }> {
  const repo = started.config.repos[started.repoKey];
  const config = {
    ...started.config,
    repos: {
      ...started.config.repos,
      [started.repoKey]: {
        ...repo,
        issueTracker: {
          ...repo.issueTracker,
          provider: "jira" as const,
          project: "TEST",
          updateOnStart: true,
          inProgressStatus: "In Progress",
          ...options.keys,
        },
      },
    },
  };
  const lines: string[] = [];
  const cancelled = await withDataRootStore(started.dataRoot, (store) => {
    const task = store.createTask({ issueKey: "TEST-5", repoKey: started.repoKey, state: "workspace_ready" });
    if (options.marked === true) store.recordTrackerMark(task.id);
    return abortWith(store, {
      config,
      ref: { ...jiraRefOf("TEST-5"), repoKey: started.repoKey },
      taskId: task.id,
      env: options.env ?? process.env,
      report: (line) => lines.push(line),
      trackerIo: { stdout: (text) => lines.push(text), stderr: (text) => lines.push(text) },
    });
  });
  return { cancelled, lines };
}

describe("abortTask", () => {
  it("deletes a published task branch before local cleanup", async () => {
    const started = await usePublishedStartedTask();
    const lines: string[] = [];

    const cancelled = await withDataRootStore(started.dataRoot, (store) =>
      abortWith(store, {
        config: started.config,
        ref: taskRefOf(started),
        taskId: started.task.id,
        report: (line) => lines.push(line),
      }),
    );

    expect(await started.origin.branchHead(started.branch)).toBeUndefined();
    expect(lines).toEqual([
      `deleted ${started.branch} on origin`,
      `removed the worktree ${started.worktree}`,
      `deleted the branch ${started.branch}`,
    ]);
    expect(cancelled.state).toBe("cancelled");
  });

  it("does not delete a branch when the task has no publication record", async () => {
    const started = await useStartedTask();
    await copyCloneBranchToOrigin({
      origin: started.origin.path,
      clone: started.clone,
      branch: started.branch,
      env: started.env,
    });
    const task = latestTaskOf(started.dataRoot, started.key);
    withDataRootStore(started.dataRoot, (store) => store.updateTask(task.id, { publishedRevision: null }));
    const remoteTip = await started.origin.branchHead(started.branch);
    const lines: string[] = [];

    await withDataRootStore(started.dataRoot, (store) =>
      abortWith(store, {
        config: started.config,
        ref: taskRefOf(started),
        taskId: task.id,
        report: (line) => lines.push(line),
      }),
    );

    expect(remoteTip).toBeTruthy();
    expect(await started.origin.branchHead(started.branch)).toBe(remoteTip);
    expect(lines.some((line) => line.startsWith("deleted ") && line.endsWith(" on origin"))).toBe(false);
  });

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
      const cancelled = await abortWith(store, { config, ref, taskId: started.task.id });
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
      abortWith(store, { config: started.config, ref, taskId }).catch((caught: unknown) => caught),
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
      abortWith(store, {
        config: started.config,
        ref,
        taskId: store.findLatestTask(started.repoKey, started.key)!.id,
      }).catch((caught: unknown) => caught),
    );

    expect(error).toBeInstanceOf(LockBusyError);
    expect((error as Error).message).toContain("the lock repo:codeguru42/tasker is busy");
    expect(await taskWorkspaceState(started)).toEqual(before);
    expect(lockNames(started.dataRoot)).toEqual([repoLockName(started.repoKey)]);
  });

  it("runs no tracker step for a Jira task when abortStatus is not set", async () => {
    const started = await useStartedTask();

    const { cancelled, lines } = await abortJiraTask(started);

    expect(cancelled.state).toBe("cancelled");
    expect(lines).toEqual([]);
    expect(eventDataOf(started.dataRoot, "TEST-5", "tracker_update")).toEqual([]);
  });

  describe("with abortStatus", () => {
    async function abortJira(options: { marked: boolean; site?: string }) {
      const started = await useStartedTask();
      const acli = fakeAcli(useTempDir("tasker-jira-"), {}, [{ args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS }]);
      const { cancelled, lines } = await abortJiraTask(started, {
        keys: { abortStatus: "Cancelled", site: options.site },
        env: { ...process.env, ...acli.env },
        marked: options.marked,
      });
      return { started, acli, lines, cancelled };
    }

    it("warns and still cancels a marked task when the site guard fails", async () => {
      const { started, acli, lines, cancelled } = await abortJira({ marked: true, site: "other.atlassian.net" });

      expect(cancelled.state).toBe("cancelled");
      expect(lines.join("")).toContain('warning: cannot move TEST-5 to the status "Cancelled" on the tracker: ');
      expect(acli.calls().map((call) => call.args)).toEqual([AUTH_STATUS_ARGS]);
      expect(eventDataOf(started.dataRoot, "TEST-5", "tracker_update").at(-1)).toMatchObject({
        action: "abort",
        result: "failed",
      });
    });

    it("makes no acli call for a task that another machine marked", async () => {
      const { started, acli, lines, cancelled } = await abortJira({ marked: false });

      expect(cancelled.state).toBe("cancelled");
      expect(acli.calls()).toEqual([]);
      expect(lines).toEqual([]);
      expect(eventDataOf(started.dataRoot, "TEST-5", "tracker_update")).toEqual([]);
    });
  });
});
