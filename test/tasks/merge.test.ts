import { describe, expect, it } from "vitest";
import { updateBranch } from "../../src/commands/update-branch.js";
import { failedFrom } from "../../src/state/machine.js";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import { mergeTask } from "../../src/tasks/merge.js";
import type { TaskStore } from "../../src/store/store.js";
import { captureIo, runCommand } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { realCommandPath } from "../helpers/fake-commands.js";
import { gitBeforeCommandEnv } from "../helpers/git.js";
import { forgeStub } from "../helpers/forge.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventsOf,
  lastErrorOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  withDataRootStore,
} from "../helpers/store.js";
import {
  taskBranchTipOf,
  taskRefOf,
  unacceptedTipError,
  useAcceptedTask,
  usePeerReviewTask,
  type AcceptedTask,
  type PeerReviewTask,
} from "../helpers/task-fixtures.js";
import { useTempDir } from "../helpers/temp.js";

// Calls mergeTask for the task of the fixture with a store, and gives the result and the io.
const callMerge = async (
  fixture: AcceptedTask | PeerReviewTask,
  store: TaskStore,
  waitMs = 300,
  env = process.env,
  forge?: ReturnType<typeof forgeStub>,
) => {
  const io = captureIo();
  const request = {
    config: fixture.config,
    ref: taskRefOf(fixture),
    taskId: fixture.task.id,
    env,
    io,
    repoLockWaitMs: waitMs,
    forge: forge?.provider,
  };
  const result = await mergeTask(store, request);
  return { result, io };
};

describe("mergeTask", () => {
  it("requests the configured PR merge at the published head and records completion", async () => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const fake = forgeStub({ mergedStatuses: [false, true] });
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.task.id, { worktreePath: null }));
    const events = eventsOf(fixture.dataRoot, fixture.key);
    const originMain = await fixture.origin.branchHead("main");

    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) =>
      callMerge(fixture, store, 300, fixture.env, fake),
    );

    expect(result).not.toEqual({ exitCode: 1 });
    expect(io.out).toEqual([]);
    expect(io.err).toEqual([]);
    expect(fake.calls.queried).toEqual([
      { number: fixture.prNumber, cwd: fixture.clone },
      { number: fixture.prNumber, cwd: fixture.clone },
    ]);
    expect(fake.calls.merged).toEqual([
      { number: fixture.prNumber, method: "merge", headSha: fixture.publishedRevision, cwd: fixture.clone },
    ]);
    expect(fake.calls.order).toEqual(["query", "merge", "query"]);
    expect(fake.calls.ci).toEqual([]);
    expect(latestTaskOf(fixture.dataRoot, fixture.key)).toMatchObject({ state: "landed", mergeOrigin: null });
    expect(eventsOf(fixture.dataRoot, fixture.key).slice(events.length)).toEqual([
      { type: "transition", data: { from: "in_peer_review", to: "merging" } },
      {
        type: "merged",
        data: {
          number: fixture.prNumber,
          method: "merge",
          forge: "github",
          expectedHead: fixture.publishedRevision,
          requested: true,
          from: "merging",
          to: "landed",
        },
      },
    ]);
    expect(await fixture.origin.branchHead("main")).toBe(originMain);
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("uses the configured squash method for a PR", async () => {
    const fixture = await usePeerReviewTask({
      repo: { forge: { provider: "github", account: "forge-team", mergeMethod: "squash" } },
    });
    const fake = forgeStub({ mergedStatuses: [false, true] });

    await withDataRootStore(fixture.dataRoot, (store) => callMerge(fixture, store, 300, fixture.env, fake));

    expect(fake.calls.merged).toEqual([
      { number: fixture.prNumber, method: "squash", headSha: fixture.publishedRevision, cwd: fixture.clone },
    ]);
  });

  it("uses the configured rebase method for a PR", async () => {
    const fixture = await usePeerReviewTask({
      repo: { forge: { provider: "github", account: "forge-team", mergeMethod: "rebase" } },
    });
    const fake = forgeStub({ mergedStatuses: [false, true] });

    await withDataRootStore(fixture.dataRoot, (store) => callMerge(fixture, store, 300, fixture.env, fake));

    expect(fake.calls.merged).toEqual([
      { number: fixture.prNumber, method: "rebase", headSha: fixture.publishedRevision, cwd: fixture.clone },
    ]);
  });

  it("records a PR that was already merged without requesting a merge", async () => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const fake = forgeStub({ mergedStatuses: [true] });
    const before = eventsOf(fixture.dataRoot, fixture.key);

    const { result } = await withDataRootStore(fixture.dataRoot, (store) =>
      callMerge(fixture, store, 300, fixture.env, fake),
    );

    expect(result).toEqual({ issueKey: fixture.key, prNumber: fixture.prNumber, forge: "github" });
    expect(fake.calls.merged).toEqual([]);
    expect(fake.calls.queried).toEqual([{ number: fixture.prNumber, cwd: fixture.clone }]);
    expect(fake.calls.order).toEqual(["query"]);
    expect(eventsOf(fixture.dataRoot, fixture.key).slice(before.length).at(-1)).toMatchObject({
      type: "merged",
      data: { requested: false, from: "merging", to: "landed" },
    });
  });

  it.each([
    {
      name: "the first merged-state query",
      setup: (fake: ReturnType<typeof forgeStub>) => fake.failQuery(new Error("status denied")),
      requests: 0,
      message: "status denied",
    },
    {
      name: "the merge request",
      setup: (fake: ReturnType<typeof forgeStub>) => fake.failMerge(new Error("request denied")),
      requests: 1,
      message: "request denied",
    },
    {
      name: "the final merged-state query",
      setup: null,
      requests: 1,
      message: "final status denied",
    },
  ])("fails from merging when $name fails and keeps the PR origin", async ({ setup, requests, message, name }) => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const fake = forgeStub({
      mergedStatuses:
        name === "the final merged-state query" ? [false, new Error("final status denied")] : [false, true],
    });
    setup?.(fake);

    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) =>
      callMerge(fixture, store, 300, fixture.env, fake),
    );

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(`merging failed: ${message}\n`);
    expect(fake.calls.merged).toHaveLength(requests);
    expect(latestTaskOf(fixture.dataRoot, fixture.key)).toMatchObject({
      state: "failed",
      mergeOrigin: "in_peer_review",
    });
    withDataRootStore(fixture.dataRoot, (store) => expect(failedFrom(store, fixture.task.id)).toBe("merging"));
  });

  it("does not wait when the forge accepts a merge request but the PR remains open", async () => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const fake = forgeStub({ mergedStatuses: [false, false] });

    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) =>
      callMerge(fixture, store, 300, fixture.env, fake),
    );

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(
      `merging failed: PR #${fixture.prNumber} is not merged. Retry after the merge completes. CAUTION: tasker abort deletes the PR head branch\n`,
    );
    expect(fake.calls.queried).toHaveLength(2);
    expect(fake.calls.merged).toHaveLength(1);
    expect(latestTaskOf(fixture.dataRoot, fixture.key)).toMatchObject({
      state: "failed",
      mergeOrigin: "in_peer_review",
    });
    expect(eventsOf(fixture.dataRoot, fixture.key).some((event) => event.type === "merged")).toBe(false);
  });

  it("names the PR when GitHub merged it but tasker cannot record landing", async () => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const fake = forgeStub({ mergedStatuses: [true] });

    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) => {
      const failing: TaskStore = {
        ...store,
        completeMerge() {
          throw new Error("database refused the event");
        },
      };
      return callMerge(fixture, failing, 300, fixture.env, fake);
    });

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(
      `merging failed: PR #${fixture.prNumber} is merged, but tasker cannot record the result: database refused the event\n`,
    );
    expect(latestTaskOf(fixture.dataRoot, fixture.key)).toMatchObject({
      state: "failed",
      mergeOrigin: "in_peer_review",
    });
    expect(fake.calls.merged).toEqual([]);
  });

  it("takes the repo lock before starting a peer-review merge", async () => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const fake = forgeStub();
    const events = eventsOf(fixture.dataRoot, fixture.key);
    const holder = startLockHolder(databasePathOf(fixture.dataRoot), repoLockName(fixture.repoKey));
    await holder.attempt;

    const error = await withDataRootStore(fixture.dataRoot, (store) =>
      failureOf(callMerge(fixture, store, 0, fixture.env, fake), LockBusyError),
    );

    expect(error.message).toContain(`the lock ${repoLockName(fixture.repoKey)} is busy`);
    expect(latestTaskOf(fixture.dataRoot, fixture.key)).toMatchObject({ state: "in_peer_review", mergeOrigin: null });
    expect(eventsOf(fixture.dataRoot, fixture.key)).toEqual(events);
    expect(fake.calls.queried).toEqual([]);
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("requires repo forge configuration even when a test supplies a provider", async () => {
    const fixture = await usePeerReviewTask();
    const fake = forgeStub();

    const error = await failureOf(
      withDataRootStore(fixture.dataRoot, (store) => callMerge(fixture, store, 300, fixture.env, fake)),
      Error,
    );

    expect(error.message).toContain(`repo "${fixture.repoKey}" has no forge configuration`);
    expect(fake.calls.queried).toEqual([]);
    expect(latestTaskOf(fixture.dataRoot, fixture.key)).toMatchObject({ state: "in_peer_review", mergeOrigin: null });
  });

  it.each([
    { field: "branch", value: null, message: "has no branch" },
    { field: "base", value: null, message: "has no base" },
    { field: "prNumber", value: null, message: "recorded PR number and published revision are required" },
    { field: "publishedRevision", value: null, message: "recorded PR number and published revision are required" },
    { field: "base", value: "refs/heads/local", message: "requires a remote base for a PR" },
  ])("refuses a peer-review task with invalid $field before starting", async ({ field, value, message }) => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const fake = forgeStub();
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.task.id, { [field]: value }));

    const error = await failureOf(
      withDataRootStore(fixture.dataRoot, (store) => callMerge(fixture, store, 300, fixture.env, fake)),
      Error,
    );

    expect(error.message).toContain(message);
    expect(latestTaskOf(fixture.dataRoot, fixture.key).state).toBe("in_peer_review");
    expect(fake.calls.queried).toEqual([]);
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it.each([
    {
      state: "accepted",
      message:
        "has not landed; land the parent first, then run tasker update-branch codeguru42/tasker#5 before merging its PR",
    },
    {
      state: "cancelled",
      message: "is cancelled; this PR needs a landed parent and an updated base before it can be merged",
    },
  ])("names a $state parent as a peer-review merge prerequisite", async ({ state, message }) => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const fake = forgeStub();
    withDataRootStore(fixture.dataRoot, (store) => {
      const parent = store.createTask({
        issueKey: "codeguru42/tasker#6",
        repoKey: fixture.repoKey,
        state,
        branch: "tasker/six",
      });
      store.updateTask(fixture.task.id, { parentTaskId: parent.id, base: "refs/heads/tasker/six" });
    });

    const error = await failureOf(
      withDataRootStore(fixture.dataRoot, (store) => callMerge(fixture, store, 300, fixture.env, fake)),
      Error,
    );

    expect(error.message).toContain(`the parent codeguru42/tasker#6 of ${fixture.key} ${message}`);
    expect(fake.calls.queried).toEqual([]);
    expect(latestTaskOf(fixture.dataRoot, fixture.key).state).toBe("in_peer_review");
  });

  it("uses the exact external-landing guidance when both PR fields are absent", async () => {
    const fixture = await usePeerReviewTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const fake = forgeStub();
    withDataRootStore(fixture.dataRoot, (store) =>
      store.updateTask(fixture.task.id, { prNumber: null, publishedRevision: null }),
    );
    const before = eventsOf(fixture.dataRoot, fixture.key);
    const error = await failureOf(
      withDataRootStore(fixture.dataRoot, (store) => callMerge(fixture, store, 300, fixture.env, fake)),
      Error,
    );
    expect(error.message).toBe(
      `cannot merge ${fixture.key}: recorded PR number and published revision are required. If the work merged externally, run tasker mark-landed ${fixture.key}`,
    );
    expect(eventsOf(fixture.dataRoot, fixture.key)).toEqual(before);
    expect(fake.calls.queried).toEqual([]);
  });

  it("keeps the trunk landing result and clears its stored origin", async () => {
    const accepted = await useAcceptedTask();

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) => callMerge(accepted, store));

    expect(result).toEqual({
      issueKey: accepted.task.issueKey,
      base: "main",
      revision: accepted.revision,
      pushed: true,
    });
    expect(io.out).toEqual([]);
    expect(io.err).toEqual([]);
    expect(eventsOf(accepted.dataRoot, accepted.key).at(-1)).toMatchObject({
      type: "landed",
      data: { revision: accepted.revision, base: "main", pushed: true },
    });
    expect(latestTaskOf(accepted.dataRoot, accepted.key).mergeOrigin).toBeNull();
  });

  it("leaves everything and releases the task lock when the repo lock is busy", async () => {
    const accepted = await useAcceptedTask();
    const events = eventsOf(accepted.dataRoot, accepted.key);
    const head = await accepted.origin.branchHead("main");
    const holder = startLockHolder(databasePathOf(accepted.dataRoot), repoLockName(accepted.repoKey));
    await holder.attempt;

    const error = await withDataRootStore(accepted.dataRoot, (store) =>
      failureOf(callMerge(accepted, store), LockBusyError),
    );

    expect(error.message).toContain(`the lock ${repoLockName(accepted.repoKey)} is busy`);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("accepted");
    expect(eventsOf(accepted.dataRoot, accepted.key)).toEqual(events);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
    expect(await accepted.origin.branchHead("main")).toBe(head);
    expect(lockNames(accepted.dataRoot)).toEqual([repoLockName(accepted.repoKey)]);
  });

  it("fails the task and names the push when the record of the landing fails", async () => {
    const accepted = await useAcceptedTask();

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) => {
      const failing: TaskStore = {
        ...store,
        completeMerge() {
          throw new Error("disk full");
        },
      };
      return callMerge(accepted, failing);
    });

    const error = `merging failed: pushed ${accepted.revision} to origin/main, but tasker cannot record the result: disk full`;
    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(`${error}\n`);
    const events = eventsOf(accepted.dataRoot, accepted.key);
    expect(lastErrorOf(accepted.dataRoot, accepted.task.id)).toBe(error);
    expect(events.some((event) => event.type === "landed")).toBe(false);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("failed");
    withDataRootStore(accepted.dataRoot, (store) => expect(failedFrom(store, accepted.task.id)).toBe("merging"));
    expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("fails the task when a commit reaches the tip during the merge", async () => {
    const accepted = await useAcceptedTask();
    const dir = useTempDir("tasker-merge-late-");
    const env = gitBeforeCommandEnv(dir, process.env, "fetch", [
      realCommandPath("git"),
      "-C",
      accepted.task.worktreePath!,
      "commit",
      "--allow-empty",
      "-m",
      "late",
    ]);

    const { result, io } = await withDataRootStore(accepted.dataRoot, (store) => callMerge(accepted, store, 300, env));

    const tip = await taskBranchTipOf(accepted);
    expect(tip).not.toBe(accepted.revision);
    const error = `merging failed: ${unacceptedTipError(accepted.task.branch!, tip, accepted.revision)}`;
    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(`${error}\n`);
    expect(lastErrorOf(accepted.dataRoot, accepted.task.id)).toBe(error);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("failed");
    withDataRootStore(accepted.dataRoot, (store) => expect(failedFrom(store, accepted.task.id)).toBe("merging"));
    expect(await accepted.origin.branchHead("main")).not.toBe(tip);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();

    const updated = await runCommand(updateBranch, "update-branch", accepted.key, "--repo", accepted.repoKey);
    expect(updated.code).toBe(0);
    expect(latestTaskOf(accepted.dataRoot, accepted.key).state).toBe("executed");
  });
});
