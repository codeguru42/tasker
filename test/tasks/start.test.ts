import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LockBusyError, repoLockName } from "../../src/store/locks.js";
import { createDataRoot } from "../../src/store/layout.js";
import { BootstrapFailedError, bootstrapFailureMessage, bootstrapLogTail, startTask } from "../../src/tasks/start.js";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import { startLockHolder } from "../helpers/processes.js";
import { lockNames, withDataRootStore } from "../helpers/store.js";
import { useStartFixture } from "../helpers/task-fixtures.js";
import { useTempDir } from "../helpers/temp.js";

describe("bootstrapFailureMessage", () => {
  const failed = { status: "failed", index: 2, command: "npm ci", timedOut: false } as const;

  it("names the exit code", () => {
    expect(bootstrapFailureMessage({ ...failed, exitCode: 3 }, "/logs/bootstrap.log", 10)).toBe(
      "bootstrap command 2 failed: npm ci: exit code 3. The log is /logs/bootstrap.log.",
    );
  });

  it("names the timeout in minutes", () => {
    expect(bootstrapFailureMessage({ ...failed, signal: "SIGTERM", timedOut: true }, "/l.log", 10)).toBe(
      "bootstrap command 2 failed: npm ci: timed out after 10 min. The log is /l.log.",
    );
  });

  it("names the signal when no timeout ended the command", () => {
    expect(bootstrapFailureMessage({ ...failed, signal: "SIGKILL" }, "/l.log", 10)).toBe(
      "bootstrap command 2 failed: npm ci: stopped by signal SIGKILL. The log is /l.log.",
    );
  });
});

describe("bootstrapLogTail", () => {
  function logWith(content: string): string {
    const path = join(useTempDir("tasker-tail-"), "bootstrap.log");
    writeFileSync(path, content);
    return path;
  }

  const numbers = (count: number) => Array.from({ length: count }, (_, i) => `${i + 1}\n`);

  it("gives the last 20 lines of a long log", () => {
    const log = logWith(numbers(30).join(""));
    expect(bootstrapLogTail(log, 20)).toBe(
      `the last 20 lines of the log:\n${numbers(30).slice(10).join("")}`,
    );
  });

  it("gives all the lines of a short log with the real count", () => {
    expect(bootstrapLogTail(logWith("1\n2\n3\n"), 20)).toBe("the last 3 lines of the log:\n1\n2\n3\n");
  });

  it("counts a last line with no line end", () => {
    expect(bootstrapLogTail(logWith("1\n2"), 20)).toBe("the last 2 lines of the log:\n1\n2\n");
  });

  it("says that the log is missing", () => {
    const log = join(useTempDir("tasker-tail-"), "none.log");
    expect(bootstrapLogTail(log, 20)).toBe(`the log is missing: ${log}\n`);
  });

  it("gives the error code of a log that cannot be read", () => {
    const log = join(useTempDir("tasker-tail-"), "folder");
    mkdirSync(log);
    expect(bootstrapLogTail(log, 20)).toBe(`cannot read the log ${log}: EISDIR\n`);
  });
});

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
        ask: () => Promise.reject(new Error("no question expected")),
        note: () => {},
      };
      const first = await startTask(store, { ...request, repoLockWaitMs: 300_000 }).catch(
        (caught: unknown) => caught,
      );
      expect(first).toBeInstanceOf(BootstrapFailedError);
      const failed = store.findLatestTask(fixture.repoKey, "codeguru42/tasker#5");
      expect(failed?.state).toBe("failed");

      const holder = startLockHolder(createDataRoot(fixture.dataRoot).database, repoLockName(fixture.repoKey));
      await holder.attempt;
      const second = await startTask(store, { ...request, repoLockWaitMs: 300 }).catch(
        (caught: unknown) => caught,
      );

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
