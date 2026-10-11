import type { DatabaseSync } from "node:sqlite";

// Rolls back the open transaction. On some errors SQLite already ended the
// transaction, so ROLLBACK fails. The caller rethrows its first error.
export function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // No transaction is open. Keep the first error.
  }
}

// Runs fn in BEGIN IMMEDIATE, so the write lock is taken at the start.
export function immediateTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    rollbackQuietly(db);
    throw error;
  }
}
