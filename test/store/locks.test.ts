import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { type LockAttempt, repoLockName, taskLockName } from "../../src/store/locks.js";
import { openStore, type TaskStore } from "../../src/store/store.js";
import { repoRoot, savePid, useTempDir, waitUntil } from "../helpers.js";

const CLOCK = "2026-01-01T00:00:00.000Z";
const now = () => new Date(CLOCK);

interface LockRow {
  pid: number;
  acquired_at: string;
}

interface LockChild {
  pid: number;
  // The JSON line of the child. It rejects, with the stderr of the child, when the child exits first.
  attempt: Promise<LockAttempt>;
  // Resolves on the exit event. Node reaps the child before it emits exit, so the pid is gone.
  exited: Promise<void>;
}

// Starts test/fixtures/lock-holder.ts and saves its pid with savePid.
function startLockChild(dbPath: string, name: string, goPath?: string): LockChild {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "test/fixtures/lock-holder.ts", dbPath, name, ...(goPath ? [goPath] : [])],
    { cwd: repoRoot },
  );
  const pid = child.pid!;
  savePid(pid);
  let stdout = "";
  let stderr = "";
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  const attempt = new Promise<LockAttempt>((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const end = stdout.indexOf("\n");
      if (end !== -1) resolve(JSON.parse(stdout.slice(0, end)) as LockAttempt);
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", () => reject(new Error(`the lock child exited first: ${stderr}`)));
  });
  // The rejection after a resolve does nothing. This stops an unhandled rejection of a killed child.
  attempt.catch(() => {});
  return { pid, attempt, exited };
}

function readRow(dbPath: string, name: string): LockRow | undefined {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare("SELECT pid, acquired_at FROM locks WHERE name = ?").get(name) as
      | LockRow
      | undefined;
  } finally {
    db.close();
  }
}

function writeRow(dbPath: string, name: string, pid: number, acquiredAt: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare("INSERT INTO locks (name, pid, acquired_at) VALUES (?, ?, ?)").run(name, pid, acquiredAt);
  } finally {
    db.close();
  }
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
      const dead = spawnSync("true").pid!;
      writeRow(dbPath, "a", dead, "2025-12-31T00:00:00.000Z");
      expect(store.tryLock("a")).toEqual({ held: true });
      expect(readRow(dbPath, "a")).toEqual({ pid: process.pid, acquired_at: CLOCK });
    });

    it("throws when this process takes the same name two times", () => {
      store.tryLock("a");
      const before = readRow(dbPath, "a");
      expect(() => store.tryLock("a")).toThrow(/\ba\b/);
      expect(readRow(dbPath, "a")).toEqual(before);
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

  it(
    "gives a lock to exactly one of two processes that try at the same time",
    async () => {
      for (let round = 0; round < 5; round++) {
        const name = `race-${round}`;
        const goPath = join(dir, `go-${round}`);
        const children = [
          startLockChild(dbPath, name, goPath),
          startLockChild(dbPath, name, goPath),
        ];
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
    },
    60_000,
  );
});
