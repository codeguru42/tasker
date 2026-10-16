import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { transitionTask } from "../../src/state/machine.js";
import { NO_OUTPUT_LINE } from "../../src/phases/command-step.js";
import { verifyCommandLogPath, verifyRunDir } from "../../src/store/layout.js";
import { verifyTask } from "../../src/tasks/verify.js";
import { captureIo } from "../helpers/cli.js";
import { readPidFile, waitUntil } from "../helpers/processes.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  seedVerifyRun,
  withDataRootStore,
} from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";
import {
  expectRefusedWithoutChange,
  taskRefOf,
  useVerifyFixture,
  type VerifyFixture,
} from "../helpers/task-fixtures.js";

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
    withDataRootStore(fixture.config.dataRoot, (store) => store.updateTask(fixture.task.id, { worktreePath: null }));

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

// The row of run 1 and the error of the last event, for a task that the verify run failed.
function failedRunOf(fixture: VerifyFixture, number = 1) {
  const { dataRoot, key } = fixture.started;
  const row = withDataRootStore(dataRoot, (store) => store.getVerifyRun(fixture.task.id, number));
  const last = eventsOf(dataRoot, key).at(-1);
  return {
    row,
    state: latestTaskOf(dataRoot, key).state,
    event: last,
    error: (last?.data as { error?: string }).error,
  };
}

// The last line of the error of a failing verify command.
function refineHint(key: string): string {
  return `Run tasker refine ${key} "<feedback>" to plan the fix, or tasker retry ${key} to run the commands again.`;
}

describe("verifyTask command failure", () => {
  it("fails the task, records the row and prints the error with the tail of the log", async () => {
    const fixture = await useVerifyFixture({ commands: ["true", "seq 1 30; exit 3"] });
    const log = verifyCommandLogPath(fixture.started.dataRoot, fixture.task, 1, 2);
    const lines = Array.from({ length: 19 }, (_, i) => `${i + 12}\n`).join("");
    const message =
      `verify command 2 failed: seq 1 30; exit 3: exit code 3. The log is ${log}.\n` +
      `the last 20 lines of the log:\n${lines}--- exit code 3\n` +
      refineHint(fixture.started.key);

    const { result, io } = await runVerifyTask(fixture);

    expect(result).toEqual({ exitCode: 1 });
    const found = failedRunOf(fixture);
    expect(found.state).toBe("failed");
    expect(found.row).toMatchObject({
      result: "failed",
      commands: ["true", "seq 1 30; exit 3"],
      failingCommand: 2,
    });
    expect(found.error).toBe(message);
    expect(found.event?.data).toEqual({ error: message, from: "verifying", to: "failed" });
    expect(io.err.join("")).toBe(`${message}\n`);
  });

  it("records a timeout as timed_out", async () => {
    const fixture = await useVerifyFixture({ commands: ["sleep 30"], limits: { verifyTimeoutMin: 0.005 } });

    const { result } = await runVerifyTask(fixture);

    expect(result).toEqual({ exitCode: 1 });
    const found = failedRunOf(fixture);
    expect(found.state).toBe("failed");
    expect(found.row).toMatchObject({ result: "timed_out", commands: ["sleep 30"], failingCommand: 1 });
    expect(found.error).toContain("sleep 30: timed out after 0.005 min. The log is ");
    expect(found.error?.endsWith(refineHint(fixture.started.key))).toBe(true);
  });

  it("adds the no-output line when the failed command wrote nothing", async () => {
    const fixture = await useVerifyFixture({ commands: ["exit 3"] });

    await runVerifyTask(fixture);

    const found = failedRunOf(fixture);
    expect(found.state).toBe("failed");
    expect(found.row).toMatchObject({ result: "failed", commands: ["exit 3"], failingCommand: 1 });
    expect(found.error?.endsWith(`${NO_OUTPUT_LINE}\n${refineHint(fixture.started.key)}`)).toBe(true);
  });

  it("numbers the second run 2 and puts its logs in verify-run-2", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => {
      seedVerifyRun(store, dataRoot, fixture.task, { result: "failed", failingCommand: 1 }, undefined, "failed");
      transitionTask(store, fixture.task.id, "executed");
    });

    const { result } = await runVerifyTask(fixture);

    expect(result).toEqual({ number: 2, commands: 1, logsDir: verifyRunDir(dataRoot, fixture.task, 2) });
    expect(verifyRunDir(dataRoot, fixture.task, 2).endsWith("verify-run-2")).toBe(true);
    expect(existsSync(verifyCommandLogPath(dataRoot, fixture.task, 2, 1))).toBe(true);
    const row = withDataRootStore(dataRoot, (store) => store.getVerifyRun(fixture.task.id, 2));
    expect(row).toMatchObject({ number: 2, result: "passed" });
  });
});

describe("verifyTask uncommitted changes", () => {
  it("fails with dirty_before when the worktree has a change before the run", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    writeFileSync(join(fixture.started.worktree, "left-over"), "x");

    const { result, io } = await runVerifyTask(fixture);

    const message =
      "the worktree had uncommitted changes before the verify run: ?? left-over\n" +
      "If the execute run left them, run tasker retry codeguru42/tasker#5 --resume-execute, " +
      "so that the execute run finishes them.";
    expect(result).toEqual({ exitCode: 1 });
    const found = failedRunOf(fixture);
    expect(found.state).toBe("failed");
    expect(found.row).toMatchObject({ result: "dirty_before", commands: [], failingCommand: null });
    expect(found.error).toBe(message);
    expect(io.err.join("")).toBe(`${message}\n`);
    expect(existsSync(verifyRunDir(fixture.started.dataRoot, fixture.task, 1))).toBe(false);
  });

  it("fails with no row when the worktree cannot be read before the run", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    rmSync(fixture.started.worktree, { recursive: true });

    await runVerifyTask(fixture);

    const found = failedRunOf(fixture);
    expect(found.state).toBe("failed");
    expect(found.error?.startsWith("cannot read the uncommitted changes of the worktree before the run: ")).toBe(true);
    expect(verifyRunCount(fixture)).toBe(0);
  });

  it("fails with dirty_after when the commands leave a change", async () => {
    const fixture = await useVerifyFixture({ commands: ["touch made-by-verify"] });

    const { result, io } = await runVerifyTask(fixture);

    const message =
      "the verify commands left uncommitted changes in the worktree: ?? made-by-verify\n" +
      "A plain tasker retry runs the commands on the same tree and fails again. " +
      "Run tasker retry codeguru42/tasker#5 --resume-execute, " +
      "so that the fix turn ignores or removes these files.";
    expect(result).toEqual({ exitCode: 1 });
    const found = failedRunOf(fixture);
    expect(found.state).toBe("failed");
    expect(found.row).toMatchObject({
      result: "dirty_after",
      commands: ["touch made-by-verify"],
      failingCommand: null,
    });
    expect(found.error).toBe(message);
    expect(io.err.join("")).toBe(`${message}\n`);
  });
});
