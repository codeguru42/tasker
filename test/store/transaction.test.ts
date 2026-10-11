import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rollbackQuietly } from "../../src/store/transaction.js";
import { makeTempDir } from "../helpers.js";

describe("transaction", () => {
  let dir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = makeTempDir("tasker-data-");
    db = new DatabaseSync(join(dir, "t.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not throw from rollbackQuietly when no transaction is open", () => {
    expect(() => rollbackQuietly(db)).not.toThrow();
  });
});
