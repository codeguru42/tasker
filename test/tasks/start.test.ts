import { describe, expect, it } from "vitest";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import { createDataRoot } from "../../src/store/layout.js";
import { BootstrapFailedError, startTask } from "../../src/tasks/start.js";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import { startLockHolder } from "../helpers/processes.js";
import { eventDataOf, lockNames, withDataRootStore } from "../helpers/store.js";
import { fixtureTrackerAnswer, trackerRepo, useStartFixture } from "../helpers/task-fixtures.js";

describe("startTask with a held repo lock", () => {
  it("waits for the lock, then leaves the task in provisioning with no new event", async () => {
    const fixture = await useStartFixture();
    await withDataRootStore(fixture.dataRoot, async (store) => {
      const holder = startLockHolder(createDataRoot(fixture.dataRoot).database, repoLockName(fixture.repoKey));
      await holder.attempt;

      const error = await startTask(store, {
        config: fixture.config,
        ref: { key: "codeguru42/tasker#5", repoKey: fixture.repoKey, shortRef: githubShortRef("5") },
        env: process.env,
        repoLockWaitMs: 300,
        ask: () => Promise.reject(new Error("no question expected")),
        note: () => {},
        reclaim: false,
        trackerIo: { stdout: () => {}, stderr: () => {} },
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LockBusyError);
      expect((error as Error).message).toContain("the lock repo:codeguru42/tasker is busy");
      const task = store.findLatestTask(fixture.repoKey, "codeguru42/tasker#5");
      expect(task?.state).toBe("provisioning");
      expect(store.listEvents(task!.id).map((event) => event.type)).toEqual(["created"]);
      expect(lockNames(fixture.dataRoot)).toEqual([repoLockName(fixture.repoKey)]);
    });
  });

  it("leaves a task that failed in bootstrap in provisioning when the repo lock is busy", async () => {
    const fixture = await useStartFixture({ repo: { bootstrap: { commands: ["exit 3"], env: [] } } });
    await withDataRootStore(fixture.dataRoot, async (store) => {
      const request = {
        config: fixture.config,
        ref: { key: "codeguru42/tasker#5", repoKey: fixture.repoKey, shortRef: githubShortRef("5") },
        env: process.env,
        repoLockWaitMs: 300,
        ask: () => Promise.reject(new Error("no question expected")),
        note: () => {},
        reclaim: false,
        trackerIo: { stdout: () => {}, stderr: () => {} },
      };
      const first = await startTask(store, { ...request, repoLockWaitMs: 300_000 }).catch((caught: unknown) => caught);
      expect(first).toBeInstanceOf(BootstrapFailedError);
      const failed = store.findLatestTask(fixture.repoKey, "codeguru42/tasker#5");
      expect(failed?.state).toBe("failed");

      const holder = startLockHolder(createDataRoot(fixture.dataRoot).database, repoLockName(fixture.repoKey));
      await holder.attempt;
      const second = await startTask(store, { ...request, repoLockWaitMs: 300 }).catch((caught: unknown) => caught);

      expect(second).toBeInstanceOf(LockBusyError);
      const task = store.findLatestTask(fixture.repoKey, "codeguru42/tasker#5");
      expect(task?.state).toBe("provisioning");
      const events = store.listEvents(task!.id);
      const last = events[events.length - 1];
      expect(last).toMatchObject({ type: "transition", data: { from: "failed", to: "provisioning" } });
      const toFailed = events.filter((event) => (event.data as { to?: string }).to === "failed");
      expect(toFailed).toHaveLength(1);
      expect(lockNames(fixture.dataRoot)).toEqual([repoLockName(fixture.repoKey)]);
    });
  });
});

describe("startTask board move order", () => {
  it("records the board move after assignment", async () => {
    const boardArgs = [
      "project",
      "item-edit",
      "42",
      "--owner",
      "octo",
      "--url",
      "https://github.com/codeguru42/tasker/issues/5",
      "--field",
      "Status",
      "--value",
      "In progress",
    ];
    const fixture = await useStartFixture({
      repo: trackerRepo({ updateOnStart: true, board: { owner: "octo", number: 42, inProgress: "In progress" } }),
      ghAnswers: [fixtureTrackerAnswer("assign"), { args: boardArgs }],
    });
    const io: string[] = [];

    await withDataRootStore(fixture.dataRoot, (store) =>
      startTask(store, {
        config: fixture.config,
        ref: { key: "codeguru42/tasker#5", repoKey: fixture.repoKey, shortRef: githubShortRef("5") },
        env: process.env,
        repoLockWaitMs: 300,
        ask: () => Promise.reject(new Error("no question expected")),
        note: () => {},
        reclaim: false,
        trackerIo: { stdout: (text) => io.push(text), stderr: (text) => io.push(text) },
      }),
    );

    expect(eventDataOf(fixture.dataRoot, "codeguru42/tasker#5", "tracker_update")).toEqual([
      { action: "assign", result: "ok" },
      { action: "board_in_progress", result: "ok" },
    ]);
    expect(io).toEqual([
      "assigned codeguru42/tasker#5 to @me on the tracker\n",
      'moved the card of codeguru42/tasker#5 to "In progress" on the tracker\n',
    ]);
    const writes = fixture.gh
      .calls()
      .map((call) => call.args)
      .filter((args) => args[0] === "issue" || args[0] === "project");
    expect(writes.at(-1)).toEqual(boardArgs);
  });
});
