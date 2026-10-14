import type { DatabaseSync } from "node:sqlite";
import { pidIsLive } from "./pid.js";
import { immediateTransaction } from "./transaction.js";

export type LockAttempt =
  | { held: true }
  | { held: false; pid: number; acquiredAt: string };

// The store functions that withLock needs. TaskStore has them.
export interface LockStore {
  // Takes the named lock when it is free or its holder is dead.
  tryLock(name: string): LockAttempt;
  // Deletes the lock only when this process holds it.
  unlock(name: string): void;
}

export function repoLockName(repoKey: string): string {
  return `repo:${repoKey}`;
}

export function taskLockName(repoKey: string, issueKey: string): string {
  return `task:${repoKey}:${issueKey}`;
}

export function tryLockIn(db: DatabaseSync, name: string, at: string): LockAttempt {
  return immediateTransaction(db, (): LockAttempt => {
    const row = db.prepare("SELECT pid, acquired_at FROM locks WHERE name = ?").get(name) as
      | { pid: number; acquired_at: string }
      | undefined;
    if (row !== undefined) {
      // The own pid is always live, so this check comes first.
      if (row.pid === process.pid) throw new Error(`this process already holds the lock ${name}`);
      if (pidIsLive(row.pid)) return { held: false, pid: row.pid, acquiredAt: row.acquired_at };
    }
    // No row, or a row of a dead pid.
    db.prepare(
      `INSERT INTO locks (name, pid, acquired_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET pid = excluded.pid, acquired_at = excluded.acquired_at`,
    ).run(name, process.pid, at);
    return { held: true };
  });
}

export function unlockIn(db: DatabaseSync, name: string): void {
  immediateTransaction(db, () => {
    db.prepare("DELETE FROM locks WHERE name = ? AND pid = ?").run(name, process.pid);
  });
}

export class LockBusyError extends Error {
  constructor(
    readonly lockName: string,
    readonly pid: number,
    readonly acquiredAt: string,
  ) {
    super(`the lock ${lockName} is busy: process ${pid} took it at ${acquiredAt}`);
    this.name = "LockBusyError";
  }
}

const RETRY_MS = 250;

// Tries the lock every RETRY_MS for at most waitMs. waitMs 0 means one try.
// An error of fn wins over an error of unlock.
export async function withLock<T>(
  store: LockStore,
  name: string,
  options: { waitMs: number },
  fn: () => T | Promise<T>,
): Promise<T> {
  const { waitMs } = options;
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    throw new RangeError(
      `the wait for the lock ${name} must be a finite number of 0 or more ms, not ${waitMs}`,
    );
  }
  const deadline = Date.now() + waitMs;
  for (;;) {
    const attempt = store.tryLock(name);
    if (attempt.held) break;
    const left = deadline - Date.now();
    if (left <= 0) throw new LockBusyError(name, attempt.pid, attempt.acquiredAt);
    await new Promise((done) => setTimeout(done, Math.min(RETRY_MS, left)));
  }
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    try {
      store.unlock(name);
    } catch {
      // Keep the error of fn.
    }
    throw error;
  }
  store.unlock(name);
  return result;
}

// Runs fn under the lock of one task, with no wait.
export function withTaskLock<T>(
  store: LockStore,
  repoKey: string,
  issueKey: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  return withLock(store, taskLockName(repoKey, issueKey), { waitMs: 0 }, fn);
}

// Runs fn under the lock of one repo. It waits at most waitMs for the lock.
export function withRepoLock<T>(
  store: LockStore,
  repoKey: string,
  waitMs: number,
  fn: () => T | Promise<T>,
): Promise<T> {
  return withLock(store, repoLockName(repoKey), { waitMs }, fn);
}
