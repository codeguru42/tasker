import { describe, expect, it } from "vitest";
import { updateBranchTask } from "../../src/tasks/update-branch.js";
import { captureIo } from "../helpers/cli.js";
import { absentRemoteNote, prBaseNote } from "../helpers/command-output.js";
import { failureOf } from "../helpers/errors.js";
import { forgeStub, type ForgeStub } from "../helpers/forge.js";
import { commitInWorktree, copyCloneBranchToOrigin } from "../helpers/git.js";
import { databasePathOf, eventsOf, latestTaskOf, withDataRootStore, withRawDatabase } from "../helpers/store.js";
import {
  landParent,
  moveTaskThrough,
  recordPr,
  taskRefOf,
  useChainedTasks,
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
async function callUpdateBranch(
  fixture: Fixture,
  forge: ForgeStub,
  base: string | undefined,
  options: { undo?: boolean } = {},
) {
  const io = captureIo();
  const result = await withDataRootStore(fixture.dataRoot, (store) =>
    updateBranchTask(store, {
      config: fixture.config,
      ref: taskRefOf(fixture),
      taskId: fixture.task.id,
      base,
      strategy: undefined,
      takeRemote: false,
      undo: options.undo === true,
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
    recordPr(fixture.dataRoot, fixture.stacked.task.id, 7);
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

    expect(io.err.join("")).toBe(prBaseNote(42, "alternate", "forge refused"));
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

describe("updateBranchTask, the forge step after the parent landed", () => {
  const cwdOf = (fixture: StackedTasks) => fixture.stacked.worktree;
  const stackedTask = (fixture: StackedTasks) => latestTaskOf(fixture.dataRoot, fixture.stacked.key);

  it("changes the base of the recorded PR to the base that the walk ends on", async () => {
    const fixture = await useStackedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    await landParent(fixture, ["accepted", "landed"]);
    await fixture.origin.addCommit("main");
    const forge = forgeStub();

    const { result } = await callUpdateBranch(stackedOf(fixture), forge, undefined);

    expect(forge.calls.baseChanged).toEqual([{ number: 42, base: "main", cwd: cwdOf(fixture) }]);
    expect(result).toMatchObject({ prBaseChanged: { number: 42, base: "main" } });
    expect(forge.calls.listed).toEqual([]);
    expect(forge.calls.created).toEqual([]);
    expect(forge.calls.merged).toEqual([]);
    expect(forge.calls.queried).toEqual([]);
    expect(forge.calls.draftQueried).toEqual([]);
    expect(forge.calls.readied).toEqual([]);
    expect(stackedTask(fixture)).toMatchObject({ base: "main", parentTaskId: null });
  });

  it("sends the base of the first task when two parents in a chain landed", async () => {
    const fixture = await useChainedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    await landParent({ ...fixture, parent: fixture.grandparent }, ["accepted", "landed"]);
    await landParent(fixture, ["accepted", "landed"]);
    const forge = forgeStub();

    await callUpdateBranch(stackedOf(fixture), forge, undefined);

    expect(forge.calls.baseChanged).toEqual([{ number: 42, base: "main", cwd: cwdOf(fixture) }]);
  });

  it("sends the branch of the next parent without refs/heads/ when that parent has not landed", async () => {
    const fixture = await useChainedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    withDataRootStore(fixture.dataRoot, (store) =>
      moveTaskThrough(store, fixture.parent.task.id, ["accepted", "landed"]),
    );
    const forge = forgeStub();

    await callUpdateBranch(stackedOf(fixture), forge, undefined);

    expect(forge.calls.baseChanged).toEqual([{ number: 42, base: fixture.grandparent.branch, cwd: cwdOf(fixture) }]);
    expect(stackedTask(fixture).base).toBe(`refs/heads/${fixture.grandparent.branch}`);
  });

  it("runs the forge step when the head does not move", async () => {
    const fixture = await useStackedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    await landParent(fixture, ["accepted", "landed"]);
    const forge = forgeStub();

    const { result } = await callUpdateBranch(stackedOf(fixture), forge, undefined);

    expect(result).toMatchObject({ moved: false });
    expect(forge.calls.baseChanged).toEqual([{ number: 42, base: "main", cwd: cwdOf(fixture) }]);
  });

  it("makes no forge call and prints no line when the task records no PR", async () => {
    const fixture = await useStackedTasks();
    await landParent(fixture, ["accepted", "landed"]);
    const forge = forgeStub();

    const { io } = await callUpdateBranch(stackedOf(fixture), forge, undefined);

    expect(forge.calls.baseChanged).toEqual([]);
    const text = io.out.join("") + io.err.join("");
    expect(text).not.toContain("changed the base");
    expect(text).not.toContain("could not change the base");
  });

  it("makes no forge call when the parent has not landed", async () => {
    const fixture = await useStackedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    const forge = forgeStub();

    await callUpdateBranch(stackedOf(fixture), forge, undefined);

    expect(forge.calls.baseChanged).toEqual([]);
  });

  it("makes no forge call with --undo", async () => {
    const fixture = await useStackedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    await landParent(fixture, ["accepted", "landed"]);
    await fixture.origin.addCommit("main");
    await callUpdateBranch(stackedOf(fixture), forgeStub(), undefined);
    const undoForge = forgeStub();

    await callUpdateBranch(stackedOf(fixture), undoForge, undefined, { undo: true });

    expect(undoForge.calls.baseChanged).toEqual([]);
  });

  it("writes the note, keeps the result and keeps the new base when the forge refuses", async () => {
    const fixture = await useStackedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    await landParent(fixture, ["accepted", "landed"]);
    const forge = forgeStub();
    forge.failBaseChange(new Error("forge refused"));

    const { result, io } = await callUpdateBranch(stackedOf(fixture), forge, undefined);

    expect(io.err.join("")).toContain(prBaseNote(42, "main", "forge refused"));
    expect(io.err.join("")).toContain(absentRemoteNote(fixture.stacked.branch));
    expect(result).not.toHaveProperty("exitCode");
    expect(result).not.toHaveProperty("prBaseChanged");
    expect(stackedTask(fixture)).toMatchObject({ base: "main", parentTaskId: null });
  });

  it("makes no forge call and keeps the base and parent when the sync step fails", async () => {
    const fixture = await useStackedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    await landParent(fixture, ["accepted", "landed"]);
    await copyCloneBranchToOrigin({
      origin: fixture.origin.path,
      clone: fixture.clone,
      branch: fixture.stacked.branch,
      env: fixture.env,
    });
    await fixture.origin.addCommit(fixture.stacked.branch, { file: "remote.txt" });
    await commitInWorktree(fixture.stacked.worktree, fixture.env, { file: "local.txt", message: "local work" });
    const forge = forgeStub();

    const { result } = await callUpdateBranch(stackedOf(fixture), forge, undefined);

    expect(result).toMatchObject({ exitCode: 1 });
    expect(forge.calls.baseChanged).toEqual([]);
    expect(stackedTask(fixture)).toMatchObject({
      base: `refs/heads/${fixture.parent.branch}`,
      parentTaskId: fixture.parent.task.id,
    });
  });

  it("makes no forge call when the base step fails", async () => {
    const fixture = await useStackedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    await landParent(fixture, ["accepted", "landed"]);
    await fixture.origin.addCommit("main", { file: "stacked.txt", content: "conflict\n" });
    const forge = forgeStub();

    const { result } = await callUpdateBranch(stackedOf(fixture), forge, undefined);

    expect(result).toMatchObject({ exitCode: 1 });
    expect(forge.calls.baseChanged).toEqual([]);
    expect(stackedTask(fixture)).toMatchObject({
      base: `refs/heads/${fixture.parent.branch}`,
      parentTaskId: fixture.parent.task.id,
    });
  });

  it("makes no forge call for a loop in the chain of parents", async () => {
    const fixture = await useStackedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    await landParent(fixture, ["accepted", "landed"]);
    withDataRootStore(fixture.dataRoot, (store) =>
      store.updateTask(fixture.parent.task.id, { parentTaskId: fixture.stacked.task.id }),
    );
    const forge = forgeStub();

    const error = await failureOf(callUpdateBranch(stackedOf(fixture), forge, undefined), Error);

    expect(error.message).toContain("has a loop at");
    expect(forge.calls.baseChanged).toEqual([]);
    expect(stackedTask(fixture).base).toBe(`refs/heads/${fixture.parent.branch}`);
  });

  it("makes no forge call for an end task with a local base and no parent", async () => {
    const fixture = await useStackedTasks();
    recordPr(fixture.dataRoot, fixture.stacked.task.id);
    await landParent(fixture, ["accepted", "landed"]);
    withRawDatabase(databasePathOf(fixture.dataRoot), (db) =>
      db.prepare("UPDATE tasks SET base = ? WHERE id = ?").run("refs/heads/other", fixture.parent.task.id),
    );
    const forge = forgeStub();

    const error = await failureOf(callUpdateBranch(stackedOf(fixture), forge, undefined), Error);

    expect(error.message).toContain("is a local branch with no parent task");
    expect(forge.calls.baseChanged).toEqual([]);
  });
});
