import { describe, expect, it } from "vitest";
import { transitionTask } from "../../src/state/machine.js";
import { verifyTask } from "../../src/tasks/verify.js";
import { captureIo } from "../helpers/cli.js";
import { lockNames, withDataRootStore } from "../helpers/store.js";
import { expectRefusedWithoutChange, taskRefOf, useVerifyFixture, type VerifyFixture } from "../helpers/task-fixtures.js";

// Runs verifyTask for the task of the fixture.
async function runVerifyTask(fixture: VerifyFixture) {
  const io = captureIo();
  const { started, task, config, env } = fixture;
  const result = await withDataRootStore(config.dataRoot, (store) =>
    verifyTask(store, { config, ref: taskRefOf(started), taskId: task.id, env, io }),
  );
  return { result, io };
}

const verifyRunCount = (fixture: VerifyFixture): number =>
  withDataRootStore(fixture.config.dataRoot, (store) => store.verifyRunCount(fixture.task.id));

describe("verifyTask checks", () => {
  it("refuses a task that is not in executed", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    withDataRootStore(fixture.config.dataRoot, (store) => transitionTask(store, fixture.task.id, "updating_branch"));

    await expectRefusedWithoutChange(
      fixture.started,
      () => runVerifyTask(fixture),
      "the task of codeguru42/tasker#5 is in updating_branch; tasker verify needs executed",
    );

    expect(verifyRunCount(fixture)).toBe(0);
    expect(lockNames(fixture.config.dataRoot)).toEqual([]);
  });

  it("refuses a task with no worktree", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    withDataRootStore(fixture.config.dataRoot, (store) =>
      store.updateTask(fixture.task.id, { worktreePath: null }),
    );

    await expectRefusedWithoutChange(
      fixture.started,
      () => runVerifyTask(fixture),
      "the task of codeguru42/tasker#5 has no worktree",
    );

    expect(verifyRunCount(fixture)).toBe(0);
    expect(lockNames(fixture.config.dataRoot)).toEqual([]);
  });
});
