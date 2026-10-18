import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { abort } from "../../src/commands/abort.js";
import { start } from "../../src/commands/start.js";
import { bootstrapLogPath } from "../../src/phases/bootstrap.js";
import { canonicalPath } from "../../src/real-path.js";
import { transitionTask } from "../../src/state/machine.js";
import { createDataRoot, taskLogsDir } from "../../src/store/layout.js";
import { taskLockName } from "../../src/store/locks.js";
import { runGit } from "../../src/vcs/git/run.js";
import { deleteTaskBranch, removeTaskWorktree } from "../../src/vcs/git/worktree.js";
import { runCommand } from "../helpers/cli.js";
import { githubLabelsAfter, trackerWriteCalls } from "../helpers/fake-gh.js";
import { localBranches } from "../helpers/git.js";
import { startLockHolder } from "../helpers/processes.js";
import { deadRunNote } from "../helpers/state-commands.js";
import {
  databasePathOf,
  eventDataOf,
  eventsOf,
  latestTaskOf,
  lockNames,
  quotaEventsOf,
  readRunMarker,
  seedDeadRun,
  seedQuotaEvent,
  seedTasks,
  withDataRootStore,
} from "../helpers/store.js";
import {
  replaceStartGh,
  taskWorkspaceState,
  trackerRepo,
  useStartFixture,
  useStartedTask,
  fixtureTrackerAnswer,
  fixtureTrackerCall,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

describe("abort", () => {
  it("cancels a task with a clean worktree, and keeps artifacts and origin", async () => {
    const started = await useStartedTask();
    expect(started.result.code).toBe(0);
    const originBefore = await localBranches(started.origin.path, started.env);
    const seeded = seedQuotaEvent(started.dataRoot, REPO);

    const result = await runCommand(abort, "abort", KEY);

    expect(result).toEqual({
      code: 0,
      out: `removed the worktree ${canonicalPath(started.worktree)}\ndeleted the branch ${started.branch}\ncancelled ${KEY}\n`,
      err: "",
    });
    expect(await taskWorkspaceState(started)).toEqual({
      state: "cancelled",
      worktree: false,
      listed: false,
      branch: false,
    });
    const task = withDataRootStore(started.dataRoot, (store) => store.findLatestTask(REPO, KEY));
    expect(existsSync(bootstrapLogPath(taskLogsDir(started.dataRoot, task!)))).toBe(true);
    expect(lockNames(started.dataRoot)).toEqual([]);
    expect(await localBranches(started.origin.path, started.env)).toEqual(originBefore);
    expect(quotaEventsOf(started.dataRoot)).toEqual([seeded]);
  });

  it("cancels a task with no branch and no worktree", async () => {
    const fixture = await useStartFixture();
    seedTasks(fixture.dataRoot, [
      { issueKey: KEY, repoKey: REPO, state: "provisioning", at: "2026-01-01T00:00:00.000Z" },
    ]);

    const result = await runCommand(abort, "abort", KEY);

    expect(result).toEqual({ code: 0, out: `cancelled ${KEY}\n`, err: "" });
    const state = withDataRootStore(fixture.dataRoot, (store) => store.findLatestTask(REPO, KEY)?.state);
    expect(state).toBe("cancelled");
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("refuses a task with a run in progress and changes nothing", async () => {
    const fixture = await useStartFixture();
    const [task] = seedTasks(fixture.dataRoot, [
      { issueKey: KEY, repoKey: REPO, state: "workspace_ready", at: "2026-01-01T00:00:00.000Z" },
    ]);
    withDataRootStore(fixture.dataRoot, (store) => transitionTask(store, task.id, "planning"));
    const dbPath = databasePathOf(fixture.dataRoot);
    const marker = readRunMarker(dbPath, task.id);
    const events = eventsOf(fixture.dataRoot, KEY);

    const result = await runCommand(abort, "abort", KEY);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `the task of ${KEY} has a run in progress in planning (tasker process ${process.pid}); wait for it, or stop that process\n`,
    });
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("planning");
    expect(readRunMarker(dbPath, task.id)).toEqual(marker);
    expect(eventsOf(fixture.dataRoot, KEY)).toEqual(events);
  });

  it("prints the note of a dead run, then cancels the task and deletes the run marker", async () => {
    const fixture = await useStartFixture();
    const [task] = seedTasks(fixture.dataRoot, [
      { issueKey: KEY, repoKey: REPO, state: "workspace_ready", at: "2026-01-01T00:00:00.000Z" },
    ]);
    seedDeadRun(fixture.dataRoot, task.id, "planning");

    const result = await runCommand(abort, "abort", KEY);

    expect(result).toEqual({
      code: 0,
      out: `cancelled ${KEY}\n`,
      err: `${deadRunNote(KEY, "planning")}\n`,
    });
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("cancelled");
    expect(readRunMarker(databasePathOf(fixture.dataRoot), task.id)).toBeUndefined();
  });

  it("cleans up and cancels a task in failed", async () => {
    const started = await useStartedTask({ repo: { bootstrap: { commands: ["exit 3"], env: [] } } });
    expect((await taskWorkspaceState(started)).state).toBe("failed");

    const result = await runCommand(abort, "abort", KEY);

    expect(result).toEqual({
      code: 0,
      out: `removed the worktree ${canonicalPath(started.worktree)}\ndeleted the branch ${started.branch}\ncancelled ${KEY}\n`,
      err: "",
    });
    expect(await taskWorkspaceState(started)).toMatchObject({ state: "cancelled", listed: false, branch: false });
  });

  it.each(["finished", "cancelled"])("refuses a %s task, because it has nothing to abort", async (state) => {
    const fixture = await useStartFixture();
    seedTasks(fixture.dataRoot, [{ issueKey: KEY, repoKey: REPO, state, at: "2026-01-01T00:00:00.000Z" }]);

    const result = await runCommand(abort, "abort", KEY);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `the task of ${KEY} is ${state}: tasker abort works only on an active task\n`,
    });
    const after = withDataRootStore(fixture.dataRoot, (store) => store.findLatestTask(REPO, KEY)?.state);
    expect(after).toBe(state);
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("fails for an issue with no task", async () => {
    const fixture = await useStartFixture();

    const result = await runCommand(abort, "abort", KEY);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `no task for the issue ${KEY} in the repo ${REPO}\n`,
    });
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  describe("with uncommitted changes", () => {
    async function dirtyTask() {
      const started = await useStartedTask();
      expect(started.result.code).toBe(0);
      writeFileSync(join(started.worktree, "README.md"), "changed\n");
      writeFileSync(join(started.worktree, "new.txt"), "new\n");
      return started;
    }

    it("refuses a dirty worktree without --force and changes nothing", async () => {
      const started = await dirtyTask();
      const before = await taskWorkspaceState(started);

      const result = await runCommand(abort, "abort", KEY);

      expect(result).toEqual({
        code: 1,
        out: "",
        err: `the worktree has uncommitted changes: ${canonicalPath(started.worktree)}\n M README.md\n?? new.txt\ntasker abort --force discards them\n`,
      });
      expect(await taskWorkspaceState(started)).toEqual(before);
      expect(readFileSync(join(started.worktree, "README.md"), "utf8")).toBe("changed\n");
      expect(readFileSync(join(started.worktree, "new.txt"), "utf8")).toBe("new\n");
      expect(lockNames(started.dataRoot)).toEqual([]);
    });

    it("discards the changes of a dirty worktree with --force", async () => {
      const started = await dirtyTask();
      const real = canonicalPath(started.worktree);

      const result = await runCommand(abort, "abort", KEY, "--force");

      expect(result).toEqual({
        code: 0,
        out: `discarded the uncommitted changes of ${real}\nremoved the worktree ${real}\ndeleted the branch ${started.branch}\ncancelled ${KEY}\n`,
        err: "",
      });
      expect(await taskWorkspaceState(started)).toMatchObject({ state: "cancelled", worktree: false });
      expect(lockNames(started.dataRoot)).toEqual([]);
    });
  });

  describe("the tracker write", () => {
    const tracked = trackerRepo({ updateOnStart: true, inProgressLabel: "in progress" });

    it("makes no write and no event when updateOnStart is false", async () => {
      const started = await useStartedTask({
        repo: trackerRepo({ updateOnStart: false, inProgressLabel: "in progress" }),
      });

      const result = await runCommand(abort, "abort", KEY);

      expect(result.code).toBe(0);
      expect(result.out).not.toContain("in-progress marker");
      expect(trackerWriteCalls(started.gh)).toEqual([]);
      expect(eventDataOf(started.dataRoot, KEY, "tracker_update")).toEqual([]);
    });

    it("makes no remove call when there is no in-progress label", async () => {
      const started = await useStartedTask({
        repo: trackerRepo({ updateOnStart: true }),
        ghAnswers: [fixtureTrackerAnswer("assign")],
      });

      const result = await runCommand(abort, "abort", KEY);

      expect(result.code).toBe(0);
      expect(trackerWriteCalls(started.gh)).toEqual([fixtureTrackerCall("assign")]);
    });

    it("removes the label after the cleanup and records an ok event", async () => {
      const started = await useStartedTask({
        repo: tracked,
        ghAnswers: [
          fixtureTrackerAnswer("assign"),
          fixtureTrackerAnswer("inProgress"),
          fixtureTrackerAnswer("clearInProgress"),
        ],
      });

      const result = await runCommand(abort, "abort", KEY);

      expect(result).toEqual({
        code: 0,
        out: `removed the worktree ${canonicalPath(started.worktree)}\ndeleted the branch ${started.branch}\ncleared the in-progress marker of ${KEY} on the tracker\ncancelled ${KEY}\n`,
        err: "",
      });
      expect(trackerWriteCalls(started.gh).at(-1)).toEqual(fixtureTrackerCall("clearInProgress"));
      expect(eventDataOf(started.dataRoot, KEY, "tracker_update").at(-1)).toEqual({
        action: "clear_in_progress",
        result: "ok",
      });
      expect(
        eventsOf(started.dataRoot, KEY)
          .slice(-2)
          .map((event) => event.type),
      ).toEqual(["tracker_update", "transition"]);
    });

    it("warns for a failed write, exits with 0 and cancels the task", async () => {
      const started = await useStartedTask({
        repo: tracked,
        ghAnswers: [
          fixtureTrackerAnswer("assign"),
          fixtureTrackerAnswer("inProgress"),
          fixtureTrackerAnswer("clearInProgress", { stderr: "cannot unlabel\n", exitCode: 1 }),
        ],
      });

      const result = await runCommand(abort, "abort", KEY);

      expect(result.code).toBe(0);
      const event = eventDataOf(started.dataRoot, KEY, "tracker_update").at(-1) as { error: string };
      expect(event).toEqual({
        action: "clear_in_progress",
        result: "failed",
        error: expect.stringContaining("cannot unlabel") as unknown,
      });
      expect(result.err).toContain(
        `warning: cannot clear the in-progress marker of ${KEY} on the tracker: ${event.error}\n`,
      );
      expect(trackerWriteCalls(started.gh).at(-1)).toEqual(fixtureTrackerCall("clearInProgress"));
      expect(latestTaskOf(started.dataRoot, KEY).state).toBe("cancelled");
      expect(result.out).not.toContain("cleared the in-progress marker");
      expect(result.out.endsWith(`cancelled ${KEY}\n`)).toBe(true);
    });

    it("lets a later start pass the marker check without --reclaim", async () => {
      const started = await useStartedTask({
        repo: tracked,
        ghAnswers: [
          fixtureTrackerAnswer("assign"),
          fixtureTrackerAnswer("inProgress"),
          fixtureTrackerAnswer("clearInProgress"),
        ],
      });
      await runCommand(abort, "abort", KEY);
      expect(trackerWriteCalls(started.gh)).toEqual([
        fixtureTrackerCall("assign"),
        fixtureTrackerCall("inProgress"),
        fixtureTrackerCall("clearInProgress"),
      ]);

      replaceStartGh(started, {
        issues: [{ project: REPO, number: 5, labels: githubLabelsAfter(started.gh, { project: REPO, number: 5 }) }],
        ghAnswers: [fixtureTrackerAnswer("assign"), fixtureTrackerAnswer("inProgress")],
      });
      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      expect(latestTaskOf(started.dataRoot, KEY).state).toBe("workspace_ready");
    });
  });

  describe("after a stop between two steps", () => {
    it("finishes an abort when the folder is gone and git still lists the worktree", async () => {
      const started = await useStartedTask();
      rmSync(started.worktree, { recursive: true, force: true });
      expect(await taskWorkspaceState(started)).toMatchObject({ worktree: false, listed: true });

      const result = await runCommand(abort, "abort", KEY);

      expect(result).toEqual({
        code: 0,
        out: `removed the worktree ${canonicalPath(started.worktree)}\ndeleted the branch ${started.branch}\ncancelled ${KEY}\n`,
        err: "",
      });
      expect(await taskWorkspaceState(started)).toEqual({
        state: "cancelled",
        worktree: false,
        listed: false,
        branch: false,
      });
    });

    it("finishes an abort when the worktree is gone and the branch exists", async () => {
      const started = await useStartedTask();
      await removeTaskWorktree({ clone: started.clone, env: started.env, path: started.worktree });

      const result = await runCommand(abort, "abort", KEY);

      expect(result).toEqual({
        code: 0,
        out: `deleted the branch ${started.branch}\ncancelled ${KEY}\n`,
        err: "",
      });
      expect(await taskWorkspaceState(started)).toMatchObject({ state: "cancelled", listed: false, branch: false });
    });

    it("finishes an abort when the worktree and the branch are gone", async () => {
      const started = await useStartedTask();
      await removeTaskWorktree({ clone: started.clone, env: started.env, path: started.worktree });
      await deleteTaskBranch({ clone: started.clone, env: started.env, branch: started.branch });

      const result = await runCommand(abort, "abort", KEY);

      expect(result).toEqual({ code: 0, out: `cancelled ${KEY}\n`, err: "" });
      expect((await taskWorkspaceState(started)).state).toBe("cancelled");
    });
  });

  it("keeps the worktree, the branch and the state when the remove fails", async () => {
    const started = await useStartedTask();
    await runGit(["worktree", "lock", "--", started.worktree], { gitDir: started.clone, env: started.env });
    const before = await taskWorkspaceState(started);

    const result = await runCommand(abort, "abort", KEY);

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).not.toBe("");
    expect(await taskWorkspaceState(started)).toEqual(before);
    expect(lockNames(started.dataRoot)).toEqual([]);
  });

  it("refuses at once when another process holds the task lock", async () => {
    const started = await useStartedTask();
    const before = await taskWorkspaceState(started);
    const name = taskLockName(REPO, KEY);
    const holder = startLockHolder(createDataRoot(started.dataRoot).database, name);
    await holder.attempt;

    const result = await runCommand(abort, "abort", KEY);

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toMatch(new RegExp(`^the lock ${name} is busy: process ${holder.pid} took it at .+\\n$`));
    expect(await taskWorkspaceState(started)).toEqual(before);
    expect(lockNames(started.dataRoot)).toEqual([name]);
  });
});
