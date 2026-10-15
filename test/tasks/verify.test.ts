import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { transitionTask } from "../../src/state/machine.js";
import { verifyCommandLogPath, verifyRunDir } from "../../src/store/layout.js";
import { verifyTask } from "../../src/tasks/verify.js";
import { captureIo } from "../helpers/cli.js";
import { readPidFile, waitUntil } from "../helpers/processes.js";
import { databasePathOf, eventsOf, latestTaskOf, lockNames, readRunMarker, withDataRootStore } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";
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

describe("verifyTask pass", () => {
  it("records a passed run and moves the task to awaiting_work_review", async () => {
    const fixture = await useVerifyFixture({ commands: ["true", "echo hi"] });
    const { dataRoot, key } = fixture.started;

    const { result } = await runVerifyTask(fixture);

    expect(result).toEqual({ number: 1, commands: 2, logsDir: verifyRunDir(dataRoot, fixture.task, 1) });
    expect(latestTaskOf(dataRoot, key).state).toBe("awaiting_work_review");
    const row = withDataRootStore(dataRoot, (store) => store.getVerifyRun(fixture.task.id, 1));
    expect(row).toMatchObject({ number: 1, result: "passed", commands: ["true", "echo hi"], failingCommand: null });
    expect(eventsOf(dataRoot, key).slice(-3)).toEqual([
      { type: "transition", data: { from: "executed", to: "verifying" } },
      { type: "verify_run", data: { number: 1, result: "passed" } },
      { type: "transition", data: { from: "verifying", to: "awaiting_work_review" } },
    ]);
    expect(existsSync(verifyCommandLogPath(dataRoot, fixture.task, 1, 1))).toBe(true);
    expect(existsSync(verifyCommandLogPath(dataRoot, fixture.task, 1, 2))).toBe(true);
    expect(readRunMarker(databasePathOf(dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("writes the pid of the running command to the run marker", async () => {
    const tmp = useTempDir("tasker-verify-pid-");
    const pidFile = join(tmp, "pid");
    const goFile = join(tmp, "go");
    const fixture = await useVerifyFixture({
      commands: [`echo $$ > ${pidFile}; while [ ! -f ${goFile} ]; do sleep 0.05; done`],
    });
    const databasePath = databasePathOf(fixture.started.dataRoot);

    const run = runVerifyTask(fixture);
    const pid = await readPidFile(pidFile, 10_000);
    await waitUntil(
      () => readRunMarker(databasePath, fixture.task.id)?.child_pid === pid,
      10_000,
      "the run marker never got the pid of the command",
    );
    writeFileSync(goFile, "");
    const { result } = await run;

    expect(result).toMatchObject({ number: 1, commands: 1 });
  });
});
