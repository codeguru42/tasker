import { describe, expect, it } from "vitest";
import { updateBranchTask } from "../../src/tasks/update-branch.js";
import { captureIo } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { forgeStub, type ForgeStub } from "../helpers/forge.js";
import { commitInWorktree, copyCloneBranchToOrigin } from "../helpers/git.js";
import { eventsOf, latestTaskOf, withDataRootStore } from "../helpers/store.js";
import {
  taskRefOf,
  useStackedTasks,
  usePeerReviewTask,
  useWorkReviewTask,
  type PeerReviewTask,
  type StackedTasks,
} from "../helpers/task-fixtures.js";

const CHANGED = "changed the base of PR #42 to alternate\n";

type Fixture = Pick<PeerReviewTask, "dataRoot" | "config" | "key" | "repoKey" | "env"> & {
  task: { id: number };
};

// Runs updateBranchTask for the task of the fixture, with the fake forge and a captured io.
async function callUpdateBranch(fixture: Fixture, forge: ForgeStub, base: string | undefined) {
  const io = captureIo();
  const result = await withDataRootStore(fixture.dataRoot, (store) =>
    updateBranchTask(store, {
      config: fixture.config,
      ref: taskRefOf(fixture),
      taskId: fixture.task.id,
      base,
      strategy: undefined,
      takeRemote: false,
      undo: false,
      env: fixture.env,
      io,
      forge: forge.provider,
      repoLockWaitMs: 300,
    }),
  );
  return { result, io };
}

// The stacked task of the fixture, in the shape of callUpdateBranch.
const stackedOf = (fixture: StackedTasks): Fixture => ({
  dataRoot: fixture.dataRoot,
  config: fixture.config,
  key: fixture.stacked.key,
  repoKey: fixture.repoKey,
  env: fixture.env,
  task: fixture.stacked.task,
});

// Local work at risk: the tips of the task branch and of its copy on origin have diverged.
async function divergeTips(work: PeerReviewTask) {
  const branch = work.task.branch!;
  await copyCloneBranchToOrigin({ origin: work.origin.path, clone: work.clone, branch, env: work.env });
  await work.origin.addCommit(branch, { file: "remote.txt" });
  await commitInWorktree(work.task.worktreePath!, work.env, { file: "local.txt", message: "local work" });
}

describe("updateBranchTask, the forge step", () => {
  it("changes the base of the recorded PR to the new base", async () => {
    const work = await usePeerReviewTask();
    await work.origin.createBranch("alternate");
    const forge = forgeStub();

    const { result } = await callUpdateBranch(work, forge, "alternate");

    expect(forge.calls.baseChanged).toEqual([{ number: 42, base: "alternate", cwd: work.task.worktreePath }]);
    expect(result).toMatchObject({ prBaseChanged: { number: 42, base: "alternate" } });
    expect(forge.calls.listed).toEqual([]);
    expect(forge.calls.created).toEqual([]);
    expect(forge.calls.merged).toEqual([]);
    expect(forge.calls.queried).toEqual([]);
  });

  it("sends the branch of a local parent, without refs/heads/", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.stacked.task.id, { prNumber: 7 }));
    const forge = forgeStub();

    const { result } = await callUpdateBranch(stackedOf(fixture), forge, `refs/heads/${fixture.parent.branch}`);

    expect(forge.calls.baseChanged).toEqual([
      { number: 7, base: fixture.parent.branch, cwd: fixture.stacked.worktree },
    ]);
    expect(result).toMatchObject({ prBaseChanged: { number: 7, base: fixture.parent.branch } });
  });

  it("makes no forge call and prints no line when the task records no PR", async () => {
    const work = await useWorkReviewTask();
    await work.origin.createBranch("alternate");
    const forge = forgeStub();

    const { io } = await callUpdateBranch(work, forge, "alternate");

    expect(forge.calls.baseChanged).toEqual([]);
    expect(io.out.join("")).not.toContain("changed the base");
    expect(io.err.join("")).not.toContain("changed the base");
    expect(io.err.join("")).not.toContain("could not change the base");
  });

  it("makes no forge call without --base", async () => {
    const work = await usePeerReviewTask();
    const forge = forgeStub();

    await callUpdateBranch(work, forge, undefined);

    expect(forge.calls.baseChanged).toEqual([]);
  });

  it("writes a note, keeps the exit code and keeps the stored base when the forge refuses", async () => {
    const work = await usePeerReviewTask();
    await work.origin.createBranch("alternate");
    // Equal tips on origin and in the clone, so that the sync step writes no note of its own.
    await copyCloneBranchToOrigin({
      origin: work.origin.path,
      clone: work.clone,
      branch: work.task.branch!,
      env: work.env,
    });
    const forge = forgeStub();
    forge.failBaseChange(new Error("forge refused"));

    const { result, io } = await callUpdateBranch(work, forge, "alternate");

    expect(io.err.join("")).toBe(
      "note: tasker could not change the base of PR #42 to alternate: forge refused; the operator must change it on the forge\n",
    );
    expect(result).not.toHaveProperty("exitCode");
    expect(result).not.toHaveProperty("prBaseChanged");
    expect(latestTaskOf(work.dataRoot, work.key).base).toBe("alternate");
  });

  it("changes nothing when the base does not exist", async () => {
    const work = await usePeerReviewTask();
    const forge = forgeStub();
    const task = latestTaskOf(work.dataRoot, work.key);
    const events = eventsOf(work.dataRoot, work.key);

    const error = await failureOf(callUpdateBranch(work, forge, "missing-base"), Error);

    expect(error.message).toContain("the base branch does not exist: missing-base (from --base)");
    expect(forge.calls.baseChanged).toEqual([]);
    expect(latestTaskOf(work.dataRoot, work.key)).toEqual(task);
    expect(eventsOf(work.dataRoot, work.key)).toEqual(events);
  });

  it("changes the PR base and prints the line before the error when the sync step fails", async () => {
    const work = await usePeerReviewTask();
    await work.origin.createBranch("alternate");
    await divergeTips(work);
    const forge = forgeStub();

    const { result, io } = await callUpdateBranch(work, forge, "alternate");

    expect(result).toEqual({ exitCode: 1 });
    expect(forge.calls.baseChanged).toEqual([{ number: 42, base: "alternate", cwd: work.task.worktreePath }]);
    expect(latestTaskOf(work.dataRoot, work.key).base).toBe("alternate");
    const err = io.err.join("");
    expect(err).toContain(CHANGED);
    expect(err.indexOf(CHANGED)).toBeLessThan(err.indexOf("have diverged"));
  });

  it("prints the line before the error when the base step fails", async () => {
    const work = await usePeerReviewTask();
    await work.origin.createBranch("alternate");
    await work.origin.addCommit("alternate", { file: "work.txt", content: "conflict\n" });
    const forge = forgeStub();

    const { result, io } = await callUpdateBranch(work, forge, "alternate");

    expect(result).toEqual({ exitCode: 1 });
    expect(forge.calls.baseChanged).toHaveLength(1);
    const err = io.err.join("");
    expect(err).toContain("stopped on conflicts");
    expect(err.indexOf(CHANGED)).toBeGreaterThanOrEqual(0);
    expect(err.indexOf(CHANGED)).toBeLessThan(err.indexOf("stopped on conflicts"));
  });
});
