import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  type LockAttempt,
  LockBusyError,
  type LockStore,
  repoLockName,
  taskLockName,
  withLock,
  withRepoLock,
  withTaskLock,
} from "../../src/store/locks.js";
import { openStore, type TaskStore } from "../../src/store/store.js";
import { failureOf } from "../helpers/errors.js";
import { deadPid, startLockHolder, waitUntil } from "../helpers/processes.js";
import { lockNames, withRawDatabase } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

const CLOCK = "2026-01-01T00:00:00.000Z";
const NAME = "repo:alpha";
const now = () => new Date(CLOCK);

interface LockRow {
  pid: number;
  acquired_at: string;
}

function readRow(dbPath: string, name: string): LockRow | undefined {
  return withRawDatabase(
    dbPath,
    (db) => db.prepare("SELECT pid, acquired_at FROM locks WHERE name = ?").get(name) as LockRow | undefined,
  );
}

function writeRow(dbPath: string, name: string, pid: number, acquiredAt: string): void {
  withRawDatabase(dbPath, (db) => {
    db.prepare("INSERT INTO locks (name, pid, acquired_at) VALUES (?, ?, ?)").run(name, pid, acquiredAt);
  });
}

describe("named locks", () => {
  let dir: string;
  let dbPath: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = useTempDir("tasker-locks-");
    dbPath = join(dir, "tasker.db");
    store = openStore(dbPath, { now });
    onTestFinished(() => store.close());
  });

  describe("tryLock and unlock", () => {
    it("takes a free name", () => {
      expect(store.tryLock("a")).toEqual({ held: true });
      expect(readRow(dbPath, "a")).toEqual({ pid: process.pid, acquired_at: CLOCK });
    });

    it("reports a lock of a live process as busy and keeps the row", () => {
      writeRow(dbPath, "a", 1, "2025-12-31T00:00:00.000Z");
      expect(store.tryLock("a")).toEqual({
        held: false,
        pid: 1,
        acquiredAt: "2025-12-31T00:00:00.000Z",
      });
      expect(readRow(dbPath, "a")).toEqual({ pid: 1, acquired_at: "2025-12-31T00:00:00.000Z" });
    });

    it("takes a lock of a dead process", () => {
      const dead = deadPid();
      writeRow(dbPath, "a", dead, "2025-12-31T00:00:00.000Z");
      expect(store.tryLock("a")).toEqual({ held: true });
      expect(readRow(dbPath, "a")).toEqual({ pid: process.pid, acquired_at: CLOCK });
    });

    it("throws when this process takes the same name two times", () => {
      store.tryLock(NAME);
      const before = readRow(dbPath, NAME);
      expect(() => store.tryLock(NAME)).toThrow("this process already holds the lock repo:alpha");
      expect(readRow(dbPath, NAME)).toEqual(before);
    });

    it("deletes the own row with unlock", () => {
      store.tryLock("a");
      store.unlock("a");
      expect(readRow(dbPath, "a")).toBeUndefined();
      expect(store.tryLock("a")).toEqual({ held: true });
    });

    it("keeps the row of another process with unlock", () => {
      writeRow(dbPath, "a", 1, "2025-12-31T00:00:00.000Z");
      store.unlock("a");
      expect(readRow(dbPath, "a")).toEqual({ pid: 1, acquired_at: "2025-12-31T00:00:00.000Z" });
    });
  });

  describe("lock names", () => {
    it("builds the name of a repo lock and of a task lock", () => {
      expect(repoLockName("tasker")).toBe("repo:tasker");
      expect(taskLockName("tasker", "codeguru42/tasker#51")).toBe("task:tasker:codeguru42/tasker#51");
    });
  });

  describe("withLock", () => {
    const BUSY: LockAttempt = { held: false, pid: 4242, acquiredAt: CLOCK };

    // A fake store. It gives the attempts in order and repeats the last one.
    function fakeStore(attempts: LockAttempt[], unlock: () => void = () => {}) {
      const calls = { tryLock: [] as number[], unlock: 0 };
      const fake: LockStore = {
        tryLock() {
          calls.tryLock.push(Date.now());
          return attempts[Math.min(calls.tryLock.length, attempts.length) - 1];
        },
        unlock() {
          calls.unlock += 1;
          unlock();
        },
      };
      return { fake, calls };
    }

    function timerCount(): number {
      return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
    }

    // Runs start on fake timers and runs each timer until no timer is left.
    async function onFakeTimers<T>(start: () => Promise<T>): Promise<T> {
      vi.useFakeTimers();
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const outcome = start();
      await vi.runAllTimersAsync();
      return outcome;
    }

    it("runs fn on a free lock, gives its value and deletes the row", async () => {
      const value = await withLock(store, "a", { waitMs: 0 }, () => {
        expect(readRow(dbPath, "a")?.pid).toBe(process.pid);
        return 7;
      });
      expect(value).toBe(7);
      expect(readRow(dbPath, "a")).toBeUndefined();
    });

    it("rejects with the error of fn and unlocks one time", async () => {
      const calls = { unlock: 0 };
      const counting: LockStore = {
        tryLock: (name) => store.tryLock(name),
        unlock: (name) => {
          calls.unlock += 1;
          store.unlock(name);
        },
      };
      const failure = new Error("fn failed");
      await expect(
        withLock(counting, "a", { waitMs: 0 }, () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(calls.unlock).toBe(1);
      expect(readRow(dbPath, "a")).toBeUndefined();
    });

    it("rejects with LockBusyError after one try when waitMs is 0", async () => {
      const { fake, calls } = fakeStore([BUSY]);
      let ran = false;
      const error = await failureOf(
        withLock(fake, NAME, { waitMs: 0 }, () => {
          ran = true;
        }),
        LockBusyError,
      );
      expect(calls.tryLock).toHaveLength(1);
      expect(error.lockName).toBe(NAME);
      expect(error.pid).toBe(4242);
      expect(error.acquiredAt).toBe(CLOCK);
      expect(error.message).toContain(NAME);
      expect(error.message).toContain("4242");
      expect(error.message).toContain(CLOCK);
      expect(ran).toBe(false);
      expect(calls.unlock).toBe(0);
    });

    it("tries again every 250 ms until the lock is free", async () => {
      const { fake, calls } = fakeStore([BUSY, BUSY, { held: true }]);
      let ran = false;
      await withLock(fake, "a", { waitMs: 5000 }, () => {
        ran = true;
      });
      expect(ran).toBe(true);
      expect(calls.tryLock).toHaveLength(3);
      expect(calls.tryLock[2] - calls.tryLock[0]).toBeGreaterThanOrEqual(450);
    });

    it("rejects with LockBusyError after waitMs", async () => {
      const { fake, calls } = fakeStore([BUSY]);
      const start = Date.now();
      await failureOf(
        withLock(fake, "a", { waitMs: 600 }, () => {}),
        LockBusyError,
      );
      expect(Date.now() - start).toBeGreaterThanOrEqual(600);
      expect(calls.tryLock.length).toBeGreaterThanOrEqual(2);
      expect(calls.tryLock.length).toBeLessThanOrEqual(4);
    });

    it("stops after the last wait when the timer ends early", async () => {
      const { fake, calls } = fakeStore([BUSY]);
      const wrapper: LockStore = {
        tryLock(name) {
          const attempt = fake.tryLock(name);
          if (calls.tryLock.length === 4) vi.setSystemTime(Date.now() - 1);
          return attempt;
        },
        unlock: (name) => fake.unlock(name),
      };
      await onFakeTimers(() =>
        failureOf(
          withLock(wrapper, "a", { waitMs: 600 }, () => {}),
          LockBusyError,
        ),
      );
      expect(calls.tryLock).toHaveLength(4);
    });

    it("keeps the error of fn when unlock also fails", async () => {
      const { fake, calls } = fakeStore([{ held: true }], () => {
        throw new Error("unlock failed");
      });
      const error = await failureOf(
        withLock(fake, NAME, { waitMs: 0 }, () => {
          throw new Error("fn failed");
        }),
        Error,
      );
      expect(error.message).toBe("fn failed");
      expect(calls.unlock).toBe(1);
    });

    it("rejects with the error of unlock when fn succeeds", async () => {
      const { fake, calls } = fakeStore([{ held: true }], () => {
        throw new Error("unlock failed");
      });
      const error = await failureOf(
        withLock(fake, NAME, { waitMs: 0 }, () => 1),
        Error,
      );
      expect(error.message).toBe("unlock failed");
      expect(calls.unlock).toBe(1);
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects a waitMs of %s before the first try",
      async (waitMs) => {
        const { fake, calls } = fakeStore([{ held: true }]);
        let ran = false;
        const error = await failureOf(
          withLock(fake, NAME, { waitMs }, () => {
            ran = true;
          }),
          RangeError,
        );
        expect(error.message).toContain(NAME);
        expect(error.message).toContain(String(waitMs));
        expect(calls.tryLock).toHaveLength(0);
        expect(ran).toBe(false);
      },
    );

    it("leaves no timer behind after a wait that ends with the lock", async () => {
      const before = timerCount();
      const { fake } = fakeStore([BUSY, { held: true }]);
      await withLock(fake, "a", { waitMs: 5000 }, () => {});
      expect(timerCount()).toBeLessThanOrEqual(before);
    });

    it("leaves no timer behind after LockBusyError", async () => {
      const before = timerCount();
      const { fake } = fakeStore([BUSY]);
      await failureOf(
        withLock(fake, "a", { waitMs: 300 }, () => {}),
        LockBusyError,
      );
      expect(timerCount()).toBeLessThanOrEqual(before);
    });

    it("rejects with LockBusyError while a child holds the lock", async () => {
      const child = startLockHolder(dbPath, NAME);
      expect(await child.attempt).toEqual({ held: true });
      const row = readRow(dbPath, NAME)!;
      expect(row.pid).toBe(child.pid);
      let ran = false;
      const error = await failureOf(
        withLock(store, NAME, { waitMs: 0 }, () => {
          ran = true;
        }),
        LockBusyError,
      );
      expect(error.pid).toBe(child.pid);
      expect(error.acquiredAt).toBe(row.acquired_at);
      expect(error.message).toContain(NAME);
      expect(error.message).toContain(String(child.pid));
      expect(error.message).toContain(row.acquired_at);
      expect(ran).toBe(false);
    }, 30_000);

    it("takes the lock of a child that was killed", async () => {
      const child = startLockHolder(dbPath, NAME);
      expect(await child.attempt).toEqual({ held: true });
      expect(readRow(dbPath, NAME)?.pid).toBe(child.pid);
      process.kill(child.pid, "SIGKILL");
      await child.exited;
      let ran = false;
      await withLock(store, NAME, { waitMs: 0 }, () => {
        ran = true;
      });
      expect(ran).toBe(true);
    }, 30_000);

    describe("withTaskLock", () => {
      it("holds the task lock with no wait and deletes it after fn", async () => {
        const name = taskLockName("alpha", "o/r#1");
        const value = await withTaskLock(store, "alpha", "o/r#1", () => {
          expect(() => store.tryLock(name)).toThrow(`this process already holds the lock ${name}`);
          return 7;
        });
        expect(value).toBe(7);
        expect(lockNames(dir)).toEqual([]);
      });

      it("rejects with LockBusyError after one try", async () => {
        const { fake, calls } = fakeStore([BUSY]);
        let ran = false;
        const error = await failureOf(
          withTaskLock(fake, "alpha", "o/r#1", () => {
            ran = true;
          }),
          LockBusyError,
        );
        expect(error.lockName).toBe(taskLockName("alpha", "o/r#1"));
        expect(calls.tryLock).toHaveLength(1);
        expect(ran).toBe(false);
      });
    });

    describe("withRepoLock", () => {
      it("holds the repo lock and deletes it after fn", async () => {
        const name = repoLockName("alpha");
        await withRepoLock(store, "alpha", 0, () => {
          expect(() => store.tryLock(name)).toThrow(`this process already holds the lock ${name}`);
        });
        expect(lockNames(dir)).toEqual([]);
      });

      it("waits for the lock and gives the value of fn", async () => {
        const { fake, calls } = fakeStore([BUSY, { held: true }]);
        const value = await withRepoLock(fake, "alpha", 1000, () => 9);
        expect(value).toBe(9);
        expect(calls.tryLock).toHaveLength(2);
      });
    });
  });

  it("gives a lock to exactly one of two processes that try at the same time", async () => {
    for (let round = 0; round < 5; round++) {
      const name = `race-${round}`;
      const goPath = join(dir, `go-${round}`);
      const children = [startLockHolder(dbPath, name, goPath), startLockHolder(dbPath, name, goPath)];
      await waitUntil(
        () => children.every((child) => existsSync(`${goPath}.ready.${child.pid}`)),
        30_000,
        `the children of round ${round} are not ready`,
      );
      writeFileSync(goPath, "");
      const attempts = await Promise.all(children.map((child) => child.attempt));
      const winners = attempts.filter((attempt) => attempt.held);
      const losers = attempts.filter((attempt) => !attempt.held);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const holder = children[attempts.findIndex((attempt) => attempt.held)];
      expect(losers[0]).toMatchObject({ held: false, pid: holder.pid });
      for (const child of children) process.kill(child.pid, "SIGKILL");
      await Promise.all(children.map((child) => child.exited));
    }
  }, 60_000);
});
