import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { immediateTransaction, rollbackQuietly } from "../../src/store/transaction.js";
import { makeTempDir, tableNames, withRawDatabase } from "../helpers.js";

describe("transaction", () => {
  let dir: string;
  let path: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = makeTempDir("tasker-data-");
    path = join(dir, "t.db");
    db = new DatabaseSync(path);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not throw from rollbackQuietly when no transaction is open", () => {
    expect(() => rollbackQuietly(db)).not.toThrow();
  });

  it("commits and returns the value of fn", () => {
    const result = immediateTransaction(db, () => {
      db.exec("CREATE TABLE a (x)");
      return 42;
    });
    expect(result).toBe(42);
    withRawDatabase(path, (other) => expect(tableNames(other)).toEqual(["a"]));
  });

  it("rolls back and rethrows the same error when fn throws", () => {
    const error = new Error("no");
    let caught: unknown;
    try {
      immediateTransaction(db, () => {
        db.exec("CREATE TABLE a (x)");
        throw error;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    expect(tableNames(db)).toEqual([]);
    expect(immediateTransaction(db, () => 1)).toBe(1);
  });

  it("keeps the first error when ROLLBACK fails", () => {
    const error = new Error("first");
    let caught: unknown;
    try {
      immediateTransaction(db, () => {
        db.exec("COMMIT");
        throw error;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
  });
});
