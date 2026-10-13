import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { abort } from "../../src/commands/abort.js";
import { bootstrapLogPath } from "../../src/phases/bootstrap.js";
import { canonicalPath } from "../../src/real-path.js";
import { taskLogsDir } from "../../src/store/layout.js";
import {
  localBranches,
  lockNames,
  runCommand,
  seedTasks,
  taskWorkspaceState,
  useStartedTask,
  useStartFixture,
  withDataRootStore,
} from "../helpers.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

describe("abort", () => {
  it("cancels a task with a clean worktree, and keeps artifacts and origin", async () => {
    const started = await useStartedTask();
    expect(started.result.code).toBe(0);
    const originBefore = await localBranches(started.origin.path, started.env);

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
});
