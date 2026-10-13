import type { DatabaseSync } from "node:sqlite";
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

// EPERM means that the process exists but belongs to another user.
function pidIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    throw error;
  }
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
