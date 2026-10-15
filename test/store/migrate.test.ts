import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, schemaVersion } from "../../src/store/migrate.js";
import { tableNames } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

describe("migrate", () => {
  let dir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = useTempDir("tasker-data-");
    db = new DatabaseSync(join(dir, "t.db"));
  });

  afterEach(() => {
    db.close();
  });

  it("takes a new database to the last version", () => {
    migrate(db, ["CREATE TABLE a (x)", "CREATE TABLE b (x)"]);
    expect(schemaVersion(db)).toBe(2);
    expect(tableNames(db)).toEqual(["a", "b"]);
  });

  it("does nothing on a second run with the same list", () => {
    const list = ["CREATE TABLE a (x)", "CREATE TABLE b (x)"];
    migrate(db, list);
    expect(() => migrate(db, list)).not.toThrow();
    expect(schemaVersion(db)).toBe(2);
  });

  it("runs only the pending versions", () => {
    migrate(db, ["CREATE TABLE a (x)"]);
    migrate(db, ["CREATE TABLE a (x)", "CREATE TABLE b (x)"]);
    expect(schemaVersion(db)).toBe(2);
    expect(tableNames(db)).toEqual(["a", "b"]);
  });

  it("throws on a file version that is newer than the list", () => {
    db.exec("PRAGMA user_version = 5");
    expect(() =>
      migrate(db, ["CREATE TABLE a (x)", "CREATE TABLE b (x)"]),
    ).toThrow(
      "database schema version 5 is newer than this tasker supports (2)",
    );
    expect(schemaVersion(db)).toBe(5);
    expect(tableNames(db)).toEqual([]);
  });

  it("rolls back to the old version when a migration fails", () => {
    expect(() => migrate(db, ["CREATE TABLE a (x)", "NOT SQL"])).toThrow();
    expect(schemaVersion(db)).toBe(0);
    expect(tableNames(db)).toEqual([]);
  });

  it("throws the first error when the transaction is already gone", () => {
    // The second string ends the transaction itself, then fails.
    expect(() =>
      migrate(db, ["CREATE TABLE a (x)", "COMMIT; NOT SQL"]),
    ).toThrow(/syntax error/);
  });
});
