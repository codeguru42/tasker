// A child process for the store open tests. It takes the write lock of a database in rollback mode,
// prints "held", and keeps the lock for holdMs ms before it commits.
// Arguments: dbPath, holdMs.
import { DatabaseSync } from "node:sqlite";

const [dbPath, holdText] = process.argv.slice(2);

try {
  const db = new DatabaseSync(dbPath);
  db.exec("BEGIN IMMEDIATE");
  console.log("held");
  setTimeout(() => {
    db.exec("COMMIT");
    db.close();
  }, Number(holdText));
} catch (error) {
  console.error(error);
  process.exit(1);
}
