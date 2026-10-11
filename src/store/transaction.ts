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
