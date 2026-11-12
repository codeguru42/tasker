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
import { runCommand, runHelp } from "../helpers/cli.js";
import { boardMoveArgs, boardMoveCalls, githubLabelsAfter, trackerWriteCalls } from "../helpers/fake-gh.js";
import { captureRejectedRemoteTaskBranchDeletion, gitBeforePushEnv, localBranches } from "../helpers/git.js";
import { realCommandPath } from "../helpers/fake-commands.js";
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
  usePublishedStartedTask,
  useStartFixture,
  useStartedTask,
  fixtureTrackerAnswer,
  fixtureTrackerCall,
} from "../helpers/task-fixtures.js";
import { useProcessEnv, useTempDir } from "../helpers/temp.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

// Runs tasker abort for the default issue of a command fixture.
function runAbort(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  return runCommand(abort, "abort", ...args);
}

describe("abort", () => {
  it("reports the exact moved-branch refusal and preserves the task", async () => {
    const started = await usePublishedStartedTask();
    const moved = await started.origin.addCommit(started.branch);
    const task = latestTaskOf(started.dataRoot, KEY);
    const events = eventsOf(started.dataRoot, KEY);
    const marker = readRunMarker(databasePathOf(started.dataRoot), task.id);
    const workspace = await taskWorkspaceState(started);
    const ghCalls = started.gh.calls();
    const trackerWrites = trackerWriteCalls(started.gh);

    const result = await runAbort(KEY);

    expect(latestTaskOf(started.dataRoot, KEY)).toEqual(task);
    expect(eventsOf(started.dataRoot, KEY)).toEqual(events);
    expect(readRunMarker(databasePathOf(started.dataRoot), task.id)).toEqual(marker);
    expect(await taskWorkspaceState(started)).toEqual(workspace);
    expect(await started.origin.branchHead(started.branch)).toBe(moved);
    expect(started.gh.calls()).toEqual(ghCalls);
    expect(trackerWriteCalls(started.gh)).toEqual(trackerWrites);
    expect(result).toEqual({
      code: 1,
      out: "",
      err: `cannot abort ${KEY}: the task branch ${started.branch} moved on origin: tasker published ${started.publishedRevision}, origin has ${moved}; someone else pushed to it; use --keep-remote to keep that branch\n`,
    });
  });

  it("reports the exact remote deletion failure and preserves the task", async () => {
    const started = await usePublishedStartedTask();
    const providerReason = await captureRejectedRemoteTaskBranchDeletion(started);
    const task = latestTaskOf(started.dataRoot, KEY);
    const events = eventsOf(started.dataRoot, KEY);
    const marker = readRunMarker(databasePathOf(started.dataRoot), task.id);
    const workspace = await taskWorkspaceState(started);
    const ghCalls = started.gh.calls();
    const trackerWrites = trackerWriteCalls(started.gh);
    const result = await runAbort(KEY);

    expect(latestTaskOf(started.dataRoot, KEY)).toEqual(task);
    expect(eventsOf(started.dataRoot, KEY)).toEqual(events);
    expect(readRunMarker(databasePathOf(started.dataRoot), task.id)).toEqual(marker);
    expect(await taskWorkspaceState(started)).toEqual(workspace);
    expect(await started.origin.branchHead(started.branch)).toBe(started.publishedRevision);
    expect(started.gh.calls()).toEqual(ghCalls);
    expect(trackerWriteCalls(started.gh)).toEqual(trackerWrites);
    expect(result).toEqual({
      code: 1,
      out: "",
      err: `cannot abort ${KEY}: cannot delete the task branch ${started.branch} on origin: ${providerReason}; run tasker abort ${KEY} again, or delete the branch from a clone of your own\n`,
    });
  });

  it("keeps a published branch and prints the exact removal hint", async () => {
    const started = await usePublishedStartedTask();

    const result = await runAbort(KEY, "--keep-remote");

    expect(result).toEqual({
      code: 0,
      out: `kept ${started.branch} on origin; to delete it: git push origin --delete ${started.branch}\nremoved the worktree ${canonicalPath(started.worktree)}\ndeleted the branch ${started.branch}\ncancelled ${KEY}\n`,
      err: "",
    });
    expect(await started.origin.branchHead(started.branch)).toBe(started.publishedRevision);
    expect(await taskWorkspaceState(started)).toMatchObject({ state: "cancelled", worktree: false, branch: false });
  });

  it("prints the keep hint for a stored branch without a publication record", async () => {
    const started = await usePublishedStartedTask();
    withDataRootStore(started.dataRoot, (store) => store.updateTask(started.task.id, { publishedRevision: null }));

    const result = await runAbort(KEY, "--keep-remote");

    expect(result).toEqual({
      code: 0,
      out: `kept ${started.branch} on origin; to delete it: git push origin --delete ${started.branch}\nremoved the worktree ${canonicalPath(started.worktree)}\ndeleted the branch ${started.branch}\ncancelled ${KEY}\n`,
      err: "",
    });
    expect(await started.origin.branchHead(started.branch)).toBe(started.publishedRevision);
    expect(latestTaskOf(started.dataRoot, KEY).state).toBe("cancelled");
  });

  it("prints no keep hint when the task has no stored branch", async () => {
    const fixture = await useStartFixture();
    seedTasks(fixture.dataRoot, [
      { issueKey: KEY, repoKey: REPO, state: "provisioning", at: "2026-01-01T00:00:00.000Z" },
    ]);

    const result = await runAbort(KEY, "--keep-remote");

    expect(result).toEqual({ code: 0, out: `cancelled ${KEY}\n`, err: "" });
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("cancelled");
  });

  it("shows the exact description and keep option help", async () => {
    const { code, help } = await runHelp(abort, "abort");

    expect(code).toBe(0);
    expect(help).toContain("Cancel an active task and remove its worktree and published task branch.");
    expect(help).toContain("--keep-remote Keep the task branch on origin during the abort.");
  });

  it("deletes the published branch before discard, cleanup, and tracker writes", async () => {
    const started = await usePublishedStartedTask({
      repo: trackerRepo({ updateOnStart: true, inProgressLabel: "in progress" }),
      ghAnswers: [
        fixtureTrackerAnswer("assign"),
        fixtureTrackerAnswer("inProgress"),
        fixtureTrackerAnswer("clearInProgress"),
      ],
    });
    writeFileSync(join(started.worktree, "README.md"), "changed\n");

    const result = await runAbort(KEY, "--force");

    expect(result).toEqual({
      code: 0,
      out: `deleted ${started.branch} on origin\ndiscarded the uncommitted changes of ${canonicalPath(started.worktree)}\nremoved the worktree ${canonicalPath(started.worktree)}\ndeleted the branch ${started.branch}\ncleared the in-progress marker of ${KEY} on the tracker\ncancelled ${KEY}\n`,
      err: "",
    });
    expect(await started.origin.branchHead(started.branch)).toBeUndefined();
    expect(trackerWriteCalls(started.gh).at(-1)).toEqual(fixtureTrackerCall("clearInProgress"));
  });

  it("accepts an already absent published branch", async () => {
    const started = await usePublishedStartedTask();
    await runGit(["update-ref", "-d", `refs/heads/${started.branch}`], {
      gitDir: started.origin.path,
      env: started.env,
    });

    const result = await runAbort(KEY);

    expect(result).toEqual({
      code: 0,
      out: `removed the worktree ${canonicalPath(started.worktree)}\ndeleted the branch ${started.branch}\ncancelled ${KEY}\n`,
      err: "",
    });
    expect(await started.origin.branchHead(started.branch)).toBeUndefined();
  });

  it("finishes when the published branch disappears during deletion", async () => {
    const started = await usePublishedStartedTask();
    const env = gitBeforePushEnv(useTempDir("tasker-abort-delete-"), process.env, [
      realCommandPath("git"),
      "--git-dir",
      started.origin.path,
      "update-ref",
      "-d",
      `refs/heads/${started.branch}`,
    ]);
    useProcessEnv({ PATH: env.PATH });

    const result = await runAbort(KEY);

    expect(result).toEqual({
      code: 0,
      out: `removed the worktree ${canonicalPath(started.worktree)}\ndeleted the branch ${started.branch}\ncancelled ${KEY}\n`,
      err: "",
    });
    expect(await started.origin.branchHead(started.branch)).toBeUndefined();
  });

  it("keeps local work after deletion succeeds and finishes on a repeat abort", async () => {
    const started = await usePublishedStartedTask();
    await runGit(["worktree", "lock", "--", started.worktree], { gitDir: started.clone, env: started.env });

    const first = await runAbort(KEY);

    expect(first.code).toBe(1);
    expect(first.out).toBe(`deleted ${started.branch} on origin\n`);
    expect(first.err).not.toBe("");
    expect(await started.origin.branchHead(started.branch)).toBeUndefined();
    expect(await taskWorkspaceState(started)).toMatchObject({ state: "workspace_ready", worktree: true, branch: true });

    await runGit(["worktree", "unlock", "--", started.worktree], { gitDir: started.clone, env: started.env });
    const second = await runAbort(KEY);

    expect(second).toEqual({
      code: 0,
      out: `removed the worktree ${canonicalPath(started.worktree)}\ndeleted the branch ${started.branch}\ncancelled ${KEY}\n`,
      err: "",
    });
  });

  it("cancels a task with a clean worktree, and keeps artifacts and origin", async () => {
    const started = await useStartedTask();
    expect(started.result.code).toBe(0);
    const originBefore = await localBranches(started.origin.path, started.env);
    const seeded = seedQuotaEvent(started.dataRoot, REPO);

    const result = await runAbort(KEY);

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

    const result = await runAbort(KEY);

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

    const result = await runAbort(KEY);

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

    const result = await runAbort(KEY);

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

    const result = await runAbort(KEY);

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

    const result = await runAbort(KEY);

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

    const result = await runAbort(KEY);

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

      const result = await runAbort(KEY);

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

      const result = await runAbort(KEY, "--force");

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

      const result = await runAbort(KEY);

      expect(result.code).toBe(0);
      expect(result.out).not.toContain("in-progress marker");
      expect(trackerWriteCalls(started.gh)).toEqual([]);
      expect(eventDataOf(started.dataRoot, KEY, "tracker_update")).toEqual([]);
    });

    it("does not move a marked board card when updateOnStart is false", async () => {
      const started = await useStartedTask({
        repo: trackerRepo({ updateOnStart: false, board: { owner: "octo", number: 42, abort: "Todo" } }),
      });
      withDataRootStore(started.dataRoot, (store) => {
        store.recordCardMark(latestTaskOf(started.dataRoot, KEY).id);
      });

      const result = await runAbort(KEY);

      expect(result.code).toBe(0);
      expect(boardMoveCalls(started.gh)).toEqual([]);
      expect(eventDataOf(started.dataRoot, KEY, "tracker_update")).toEqual([
        { action: "board_in_progress", result: "ok" },
      ]);
    });

    it("moves to board.abort only when cardMarked is true", async () => {
      const boardArgs = boardMoveArgs(
        { owner: "octo", number: 42, field: "Status" },
        { project: "codeguru42/tasker", number: 5 },
        "Todo",
      );
      const started = await useStartedTask({
        repo: trackerRepo({ updateOnStart: true, board: { owner: "octo", number: 42, abort: "Todo" } }),
        ghAnswers: [fixtureTrackerAnswer("assign"), { args: boardArgs }],
      });
      withDataRootStore(started.dataRoot, (store) => {
        store.recordCardMark(latestTaskOf(started.dataRoot, KEY).id);
      });

      const result = await runAbort(KEY);

      expect(result.code).toBe(0);
      expect(result.out).toContain(`moved the card of ${KEY} to "Todo" on the tracker\n`);
      expect(result.out.indexOf(`moved the card of ${KEY}`)).toBeLessThan(result.out.indexOf(`cancelled ${KEY}`));
      expect(boardMoveCalls(started.gh)).toEqual([boardArgs]);
      expect(eventDataOf(started.dataRoot, KEY, "tracker_update").at(-1)).toEqual({
        action: "board_abort",
        result: "ok",
      });
    });

    it("does not move to board.abort when cardMarked is false", async () => {
      const started = await useStartedTask({
        repo: trackerRepo({ updateOnStart: true, board: { owner: "octo", number: 42, abort: "Todo" } }),
        ghAnswers: [fixtureTrackerAnswer("assign")],
      });

      const result = await runAbort(KEY);

      expect(result.code).toBe(0);
      expect(boardMoveCalls(started.gh)).toEqual([]);
      expect(eventDataOf(started.dataRoot, KEY, "tracker_update")).toEqual([{ action: "assign", result: "ok" }]);
    });

    it("does not move to board.abort when trackerMarked is the only mark", async () => {
      const started = await useStartedTask({
        repo: trackerRepo({
          updateOnStart: true,
          inProgressLabel: "in progress",
          board: { owner: "octo", number: 42, abort: "Todo" },
        }),
        ghAnswers: [
          fixtureTrackerAnswer("assign"),
          fixtureTrackerAnswer("inProgress"),
          fixtureTrackerAnswer("clearInProgress"),
        ],
      });

      const result = await runAbort(KEY);

      expect(result.code).toBe(0);
      expect(boardMoveCalls(started.gh)).toEqual([]);
      expect(eventDataOf(started.dataRoot, KEY, "tracker_update").at(-1)).toEqual({
        action: "clear_in_progress",
        result: "ok",
      });
    });

    it("moves the board card even when clearing the label fails", async () => {
      const boardArgs = boardMoveArgs(
        { owner: "octo", number: 42, field: "Status" },
        { project: "codeguru42/tasker", number: 5 },
        "Todo",
      );
      const started = await useStartedTask({
        repo: trackerRepo({
          updateOnStart: true,
          inProgressLabel: "in progress",
          board: { owner: "octo", number: 42, abort: "Todo" },
        }),
        ghAnswers: [
          fixtureTrackerAnswer("assign"),
          fixtureTrackerAnswer("inProgress"),
          fixtureTrackerAnswer("clearInProgress", { stderr: "cannot unlabel\n", exitCode: 1 }),
          { args: boardArgs },
        ],
      });
      withDataRootStore(started.dataRoot, (store) => {
        store.recordCardMark(latestTaskOf(started.dataRoot, KEY).id);
      });

      const result = await runAbort(KEY);

      expect(result.code).toBe(0);
      const updates = eventDataOf(started.dataRoot, KEY, "tracker_update") as { action: string; result: string }[];
      expect(updates.slice(-4)).toEqual([
        { action: "in_progress", result: "ok" },
        { action: "board_in_progress", result: "ok" },
        expect.objectContaining({ action: "clear_in_progress", result: "failed" }),
        { action: "board_abort", result: "ok" },
      ]);
      expect(result.err).toContain(`warning: cannot clear the in-progress marker of ${KEY} on the tracker:`);
      expect(result.out).toContain(`moved the card of ${KEY} to "Todo" on the tracker\n`);
      expect(boardMoveCalls(started.gh)).toEqual([boardArgs]);
    });

    it("warns when the board abort move fails", async () => {
      const boardArgs = boardMoveArgs(
        { owner: "octo", number: 42, field: "Status" },
        { project: "codeguru42/tasker", number: 5 },
        "Todo",
      );
      const started = await useStartedTask({
        repo: trackerRepo({ updateOnStart: true, board: { owner: "octo", number: 42, abort: "Todo" } }),
        ghAnswers: [fixtureTrackerAnswer("assign"), { args: boardArgs, stderr: "board denied\n", exitCode: 1 }],
      });
      withDataRootStore(started.dataRoot, (store) => {
        store.recordCardMark(latestTaskOf(started.dataRoot, KEY).id);
      });

      const result = await runAbort(KEY);

      expect(result.code).toBe(0);
      expect(latestTaskOf(started.dataRoot, KEY).state).toBe("cancelled");
      const event = eventDataOf(started.dataRoot, KEY, "tracker_update").at(-1) as { action: string; result: string };
      expect(event).toMatchObject({ action: "board_abort", result: "failed" });
      expect(result.err).toContain(`warning: cannot move the card of ${KEY} to "Todo" on the tracker:`);
      expect(boardMoveCalls(started.gh)).toEqual([boardArgs]);
    });

    it("makes no remove call when there is no in-progress label", async () => {
      const started = await useStartedTask({
        repo: trackerRepo({ updateOnStart: true }),
        ghAnswers: [fixtureTrackerAnswer("assign")],
      });

      const result = await runAbort(KEY);

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

      expect(eventDataOf(started.dataRoot, KEY, "tracker_update")).toContainEqual({
        action: "in_progress",
        result: "ok",
      });

      const result = await runAbort(KEY);

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

    it("does not remove the label when provisioning fails before the marker write", async () => {
      const started = await useStartedTask({
        repo: {
          ...tracked,
          bootstrap: { commands: ["exit 3"], env: [] },
        },
        ghAnswers: [
          fixtureTrackerAnswer("assign"),
          fixtureTrackerAnswer("inProgress"),
          fixtureTrackerAnswer("clearInProgress"),
        ],
      });

      expect(started.result.code).toBe(1);
      expect(
        eventDataOf(started.dataRoot, KEY, "tracker_update").filter(
          (event) => (event as { action?: string }).action === "in_progress",
        ),
      ).toEqual([]);

      const result = await runAbort(KEY);

      expect(result.code).toBe(0);
      expect(latestTaskOf(started.dataRoot, KEY).state).toBe("cancelled");
      expect(trackerWriteCalls(started.gh)).not.toContainEqual(fixtureTrackerCall("clearInProgress"));
      expect(eventDataOf(started.dataRoot, KEY, "tracker_update")).not.toContainEqual(
        expect.objectContaining({ action: "clear_in_progress" }),
      );
      expect(result.out).not.toContain("in-progress marker");
      expect(result.err).not.toContain("in-progress marker");
    });

    it("does not remove the label when the marker write failed", async () => {
      const started = await useStartedTask({
        repo: tracked,
        ghAnswers: [
          fixtureTrackerAnswer("assign"),
          fixtureTrackerAnswer("inProgress", { stderr: "cannot label\n", exitCode: 1 }),
          fixtureTrackerAnswer("clearInProgress"),
        ],
      });

      expect(eventDataOf(started.dataRoot, KEY, "tracker_update")).toContainEqual(
        expect.objectContaining({ action: "in_progress", result: "failed" }),
      );

      const result = await runAbort(KEY);

      expect(result.code).toBe(0);
      expect(latestTaskOf(started.dataRoot, KEY).state).toBe("cancelled");
      expect(trackerWriteCalls(started.gh)).not.toContainEqual(fixtureTrackerCall("clearInProgress"));
      expect(eventDataOf(started.dataRoot, KEY, "tracker_update")).not.toContainEqual(
        expect.objectContaining({ action: "clear_in_progress" }),
      );
      expect(result.out).not.toContain("in-progress marker");
      expect(result.err).not.toContain("in-progress marker");
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

      const result = await runAbort(KEY);

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
      await runAbort(KEY);
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

      const result = await runAbort(KEY);

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

      const result = await runAbort(KEY);

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

      const result = await runAbort(KEY);

      expect(result).toEqual({ code: 0, out: `cancelled ${KEY}\n`, err: "" });
      expect((await taskWorkspaceState(started)).state).toBe("cancelled");
    });
  });

  it("keeps the worktree, the branch and the state when the remove fails", async () => {
    const started = await useStartedTask();
    await runGit(["worktree", "lock", "--", started.worktree], { gitDir: started.clone, env: started.env });
    const before = await taskWorkspaceState(started);

    const result = await runAbort(KEY);

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

    const result = await runAbort(KEY);

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toMatch(new RegExp(`^the lock ${name} is busy: process ${holder.pid} took it at .+\\n$`));
    expect(await taskWorkspaceState(started)).toEqual(before);
    expect(lockNames(started.dataRoot)).toEqual([name]);
  });
});
