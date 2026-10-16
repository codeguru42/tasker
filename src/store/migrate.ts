import type { DatabaseSync } from "node:sqlite";
import { immediateTransaction } from "./transaction.js";

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

// Version N means that the first N migrations ran.
export function migrate(db: DatabaseSync, migrations: readonly string[]): void {
  immediateTransaction(db, () => {
    const found = schemaVersion(db);
    if (found > migrations.length) {
      throw new Error(`database schema version ${found} is newer than this tasker supports (${migrations.length})`);
    }
    for (let i = found; i < migrations.length; i++) {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    }
  });
}
