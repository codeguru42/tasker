import { existsSync } from "node:fs";
import { join } from "node:path";
import { CommanderError } from "commander";
import { describe, expect, it } from "vitest";
import {
  fail,
  issueKeyOrFail,
  orFail,
  orFailAsync,
  repoKeyOrFail,
  withIssueTaskAsync,
  withStore,
  withStoreAsync,
} from "../../src/commands/shared.js";
import { parseConfig } from "../../src/config/schema.js";
import { IssueKeyError } from "../../src/issue-key/ref.js";
import type { TaskStore } from "../../src/store/store.js";
import { captureIo, failureOf, useTempDir, seedTasks, thrownBy, validConfig, withDataRootStore } from "../helpers.js";

describe("orFail", () => {
  it("returns the value of fn and writes nothing", () => {
    const io = captureIo();

    expect(orFail(io, () => 42)).toBe(42);
    expect(io.out).toEqual([]);
    expect(io.err).toEqual([]);
  });

  it("writes the message of the error to stderr and exits with code 1", () => {
    const io = captureIo();
    let error: unknown;
    try {
      orFail(io, () => {
        throw new Error("boom");
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(1);
    expect(io.err.join("")).toBe("boom\n");
    expect(io.out).toEqual([]);
  });
});

describe("orFail with a CommanderError", () => {
  it("rethrows the same error and writes the message one time only", () => {
    const io = captureIo();
    const error = thrownBy(() =>
      orFail(io, () => {
        fail(io, "boom");
      }),
    );

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(1);
    expect(io.err).toEqual(["boom\n"]);
  });
});

describe("orFailAsync", () => {
  it("returns the value of fn and writes nothing", async () => {
    const io = captureIo();

    expect(await orFailAsync(io, async () => 42)).toBe(42);
    expect(io.out).toEqual([]);
    expect(io.err).toEqual([]);
  });

  it("writes the message of the error to stderr and exits with code 1", async () => {
    const io = captureIo();
    const error = await failureOf(
      orFailAsync(io, async () => {
        throw new Error("boom");
      }),
      CommanderError,
    );

    expect(error.exitCode).toBe(1);
    expect(io.err).toEqual(["boom\n"]);
    expect(io.out).toEqual([]);
  });

  it("writes the text of the message function", async () => {
    const io = captureIo();
    const error = await failureOf(
      orFailAsync(
        io,
        async () => {
          throw new Error("boom");
        },
        (cause) => `custom: ${(cause as Error).message}`,
      ),
      CommanderError,
    );

    expect(error.exitCode).toBe(1);
    expect(io.err).toEqual(["custom: boom\n"]);
  });

  it("rethrows a CommanderError as the same object and writes the message one time only", async () => {
    const io = captureIo();
    let inner: unknown;
    const error = await failureOf(
      orFailAsync(io, async () => {
        try {
          fail(io, "boom");
        } catch (caught) {
          inner = caught;
          throw caught;
        }
      }),
      CommanderError,
    );

    expect(error).toBe(inner);
    expect(io.err).toEqual(["boom\n"]);
  });
});

describe("repoKeyOrFail", () => {
  const config = parseConfig(validConfig(), {}, "/home/test");
  const [key] = Object.keys(config.repos);

  it("writes nothing for a known key", () => {
    const io = captureIo();

    repoKeyOrFail(io, config, key);
    expect(io.err).toEqual([]);
    expect(io.out).toEqual([]);
  });

  it("writes the message and exits with code 1 for an unknown key", () => {
    const io = captureIo();
    const error = thrownBy(() => repoKeyOrFail(io, config, "nope"));

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(1);
    expect(io.err).toEqual(["repo key not found: nope\n"]);
  });
});

describe("issueKeyOrFail", () => {
  it("returns the value of fn", () => {
    const io = captureIo();

    expect(issueKeyOrFail(io, () => 42)).toBe(42);
    expect(io.err).toEqual([]);
  });

  it("writes the message of an IssueKeyError one time and exits with code 1", () => {
    const io = captureIo();
    const error = thrownBy(() =>
      issueKeyOrFail(io, () => {
        throw new IssueKeyError("x", "bad key");
      }),
    );

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(1);
    expect(io.err).toEqual(["bad key\n"]);
  });

  it("rethrows another error as the same object and writes nothing", () => {
    const io = captureIo();
    const original = new Error("boom");
    const error = thrownBy(() =>
      issueKeyOrFail(io, () => {
        throw original;
      }),
    );

    expect(error).toBe(original);
    expect(io.err).toEqual([]);
  });
});

describe("withStore", () => {
  let dataRoot: string;

  function configFor(dir: string) {
    dataRoot = dir;
    return parseConfig({ ...validConfig(), dataRoot: dir }, {}, "/home/test");
  }

  it("returns the value of fn and leaves the store closed", () => {
    const config = configFor(useTempDir("tasker-store-"));

    const task = withStore(config, (store) =>
      store.createTask({ issueKey: "codeguru42/tasker#1", repoKey: "tasker", state: "planning" }),
    );

    const database = join(dataRoot, "tasker.db");
    expect(existsSync(database)).toBe(true);
    expect(existsSync(`${database}-wal`)).toBe(false);
    withDataRootStore(dataRoot, (store) => {
      expect(store.getTask(task.id)).toEqual(task);
    });
  });

  it("closes the store when fn throws", () => {
    const config = configFor(useTempDir("tasker-store-"));

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
  function configFor(dir: string) {
    return parseConfig({ ...validConfig(), dataRoot: dir }, {}, "/home/test");
  }

  it("keeps the store open across an await in fn", async () => {
    const config = configFor(useTempDir("tasker-store-"));

    const task = await withStoreAsync(config, async (store) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return store.createTask({ issueKey: "codeguru42/tasker#1", repoKey: "tasker", state: "planning" });
    });

    expect(task.issueKey).toBe("codeguru42/tasker#1");
  });

  it("closes the store after the promise resolves", async () => {
    const config = configFor(useTempDir("tasker-store-"));

    const store = await withStoreAsync(config, async (opened) => opened);

    expect(() => store.findActiveTask("tasker", "codeguru42/tasker#1")).toThrow();
  });

  it("closes the store after fn rejects and passes the rejection through", async () => {
    const config = configFor(useTempDir("tasker-store-"));
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

describe("withIssueTaskAsync", () => {
  const REPO = "codeguru42/tasker";
  const KEY = "codeguru42/tasker#1";
  let dataRoot: string;

  function configFor(dir: string) {
    dataRoot = dir;
    const raw = validConfig();
    raw.repos = { [REPO]: raw.repos.tasker };
    return parseConfig({ ...raw, dataRoot: dir }, {}, "/home/test");
  }

  function seed() {
    const [task] = seedTasks(dataRoot, [
      { issueKey: KEY, repoKey: REPO, state: "planning", at: "2026-01-01T00:00:00.000Z" },
    ]);
    return task!;
  }

  it("calls fn with the store, the task and the ref", async () => {
    const config = configFor(useTempDir("tasker-store-"));
    const seeded = seed();

    const seen = await withIssueTaskAsync(captureIo(), config, KEY, {}, async (store, task, ref) => ({
      store,
      task,
      ref,
    }));

    expect(seen.task).toEqual(seeded);
    expect(seen.ref).toMatchObject({ key: KEY, repoKey: REPO });
    expect(seen.store).toBeDefined();
  });

  it("keeps the store open across an await and gives the value", async () => {
    const config = configFor(useTempDir("tasker-store-"));
    seed();

    const value = await withIssueTaskAsync(captureIo(), config, KEY, {}, async (store, task) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return store.getTask(task.id)?.issueKey;
    });

    expect(value).toBe(KEY);
  });

  it("closes the store after the promise settles", async () => {
    const config = configFor(useTempDir("tasker-store-"));
    seed();

    const store = await withIssueTaskAsync(captureIo(), config, KEY, {}, async (opened) => opened);

    expect(() => store.findActiveTask(REPO, KEY)).toThrow();
  });

  it("fails with exit code 1 for an issue with no task", async () => {
    const config = configFor(useTempDir("tasker-store-"));
    const io = captureIo();
    let called = false;

    const error = await withIssueTaskAsync(io, config, KEY, {}, async () => {
      called = true;
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(1);
    expect(io.err.join("")).toBe(`no task for the issue ${KEY} in the repo ${REPO}\n`);
    expect(called).toBe(false);
  });
});
