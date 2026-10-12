import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withStore } from "../../src/commands/shared.js";
import { parseConfig } from "../../src/config/schema.js";
import { openStore } from "../../src/store/store.js";
import { makeTempDir, validConfig } from "../helpers.js";

describe("withStore", () => {
  let dataRoot: string;

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  function configFor(dir: string) {
    dataRoot = dir;
    return parseConfig({ ...validConfig(), dataRoot: dir }, {}, "/home/test");
  }

  it("returns the value of fn and leaves the store closed", () => {
    const config = configFor(makeTempDir("tasker-store-"));

    const task = withStore(config, (store) =>
      store.createTask({ issueKey: "codeguru42/tasker#1", repoKey: "tasker", state: "planning" }),
    );

    const database = join(dataRoot, "tasker.db");
    expect(existsSync(database)).toBe(true);
    expect(existsSync(`${database}-wal`)).toBe(false);
    const store = openStore(database);
    try {
      expect(store.getTask(task.id)).toEqual(task);
    } finally {
      store.close();
    }
  });

  it("closes the store when fn throws", () => {
    const config = configFor(makeTempDir("tasker-store-"));

    expect(() =>
      withStore(config, (store) => {
        store.createTask({ issueKey: "codeguru42/tasker#1", repoKey: "tasker", state: "planning" });
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(existsSync(join(dataRoot, "tasker.db-wal"))).toBe(false);
  });
});
