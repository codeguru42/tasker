import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withStore, withStoreAsync } from "../../src/commands/shared.js";
import { parseConfig } from "../../src/config/schema.js";
import { openStore, type TaskStore } from "../../src/store/store.js";
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

describe("withStoreAsync", () => {
  let dataRoot: string;

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  function configFor(dir: string) {
    dataRoot = dir;
    return parseConfig({ ...validConfig(), dataRoot: dir }, {}, "/home/test");
  }

  it("keeps the store open across an await in fn", async () => {
    const config = configFor(makeTempDir("tasker-store-"));

    const task = await withStoreAsync(config, async (store) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return store.createTask({ issueKey: "codeguru42/tasker#1", repoKey: "tasker", state: "planning" });
    });

    expect(task.issueKey).toBe("codeguru42/tasker#1");
  });

  it("closes the store after the promise resolves", async () => {
    const config = configFor(makeTempDir("tasker-store-"));

    const store = await withStoreAsync(config, async (opened) => opened);

    expect(() => store.findActiveTask("tasker", "codeguru42/tasker#1")).toThrow();
  });

  it("closes the store after fn rejects and passes the rejection through", async () => {
    const config = configFor(makeTempDir("tasker-store-"));
    let seen: TaskStore | undefined;

    await expect(
      withStoreAsync(config, async (store) => {
        seen = store;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(() => seen?.findActiveTask("tasker", "codeguru42/tasker#1")).toThrow();
  });
});
