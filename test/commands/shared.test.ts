import { existsSync } from "node:fs";
import { join } from "node:path";
import { CommanderError } from "commander";
import { describe, expect, it } from "vitest";
import {
  fail,
  issueKeyOrFail,
  numberedRowOrFail,
  orFail,
  orFailAsync,
  repoKeyOrFail,
  warnOverlaps,
  wholeNumberOptionsOrFail,
  withFinalLineEnd,
  withIssueTask,
  withIssueTaskAsync,
  withStore,
  withStoreAsync,
} from "../../src/commands/shared.js";
import { parseConfig } from "../../src/config/schema.js";
import { IssueKeyError } from "../../src/issue-key/ref.js";
import { taskNotFound, type TaskStore } from "../../src/store/store.js";
import { captureIo } from "../helpers/cli.js";
import { validConfig } from "../helpers/config.js";
import { failureOf, thrownBy } from "../helpers/errors.js";
import { deadRunNote } from "../helpers/state-commands.js";
import { seedDeadRun, seedTasks, withDataRootStore } from "../helpers/store.js";
import { useTempDir } from "../helpers/temp.js";

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
    return task;
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

describe("the dead-run step of the task lookup", () => {
  const REPO = "codeguru42/tasker";
  const KEY = "codeguru42/tasker#1";
  const NOTE = `${deadRunNote(KEY, "executing")}\n`;

  // A config with a data root that holds the task KEY in executing, with a live run or a dead run.
  function seedConfig(run: "live" | "dead") {
    const dataRoot = useTempDir("tasker-store-");
    const raw = validConfig();
    raw.repos = { [REPO]: raw.repos.tasker };
    const config = parseConfig({ ...raw, dataRoot }, {}, "/home/test");
    const [task] = seedTasks(dataRoot, [
      {
        issueKey: KEY,
        repoKey: REPO,
        state: run === "live" ? "executing" : "approved",
        at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    if (run === "dead") seedDeadRun(dataRoot, task.id, "executing");
    return config;
  }

  it("gives withIssueTaskAsync the interrupted task and writes the note on stderr", async () => {
    const config = seedConfig("dead");
    const io = captureIo();

    const state = await withIssueTaskAsync(io, config, KEY, {}, async (_store, task) => task.state);

    expect(state).toBe("interrupted");
    expect(io.err).toEqual([NOTE]);
  });

  it("gives withIssueTask the interrupted task and writes the note on stderr", async () => {
    const config = seedConfig("dead");
    const io = captureIo();

    const state = await withIssueTask(io, config, KEY, {}, (_store, task) => task.state);

    expect(state).toBe("interrupted");
    expect(io.err).toEqual([NOTE]);
  });

  it("writes nothing on stderr for a live run", async () => {
    const config = seedConfig("live");
    const io = captureIo();

    const state = await withIssueTaskAsync(io, config, KEY, {}, async (_store, task) => task.state);

    expect(state).toBe("executing");
    expect(io.err).toEqual([]);
  });
});

describe("warnOverlaps", () => {
  it("prints one note line and resolves when the task is missing", async () => {
    const config = parseConfig({ ...validConfig(), dataRoot: useTempDir("tasker-warn-") }, {}, "/home/test");
    const io = captureIo();

    await warnOverlaps(io, config, { taskId: 999, files: ["src/a.ts"], env: {}, lastLines: ["last"] });

    expect(io.err).toEqual([
      `note: cannot compare the plan with the other tasks in flight: ${taskNotFound(999).message}\n`,
    ]);
  });
});

describe("wholeNumberOptionsOrFail", () => {
  it.each([
    ["absent options", { "--x": undefined, "--y": undefined }],
    ["1 and 12", { "--x": "1", "--y": "12" }],
  ])("writes nothing for %s", (_name, options) => {
    const io = captureIo();

    wholeNumberOptionsOrFail(io, options);

    expect(io.out).toEqual([]);
    expect(io.err).toEqual([]);
  });

  it.each(["0", "01", "-1", "1.5", "+1", "abc"])("stops the command with exit code 1 for %s", (value) => {
    const io = captureIo();

    const error = thrownBy(() => wholeNumberOptionsOrFail(io, { "--x": value }));

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(1);
    expect(io.err).toEqual([`--x must be a whole number of 1 or more: ${value}\n`]);
    expect(io.out).toEqual([]);
  });

  it("reports two bad options in the given order in one write", () => {
    const io = captureIo();

    thrownBy(() => wholeNumberOptionsOrFail(io, { "--run": "0", "--good": "3", "--command": "01" }));

    expect(io.err).toEqual([
      "--run must be a whole number of 1 or more: 0\n--command must be a whole number of 1 or more: 01\n",
    ]);
  });
});

describe("withFinalLineEnd", () => {
  it.each([
    ["a", "a\n"],
    ["a\n", "a\n"],
    ["a\r\n", "a\r\n"],
    ["", "\n"],
  ])("turns %j into %j", (text, expected) => {
    expect(withFinalLineEnd(text)).toBe(expected);
  });
});

function rowOf(io: ReturnType<typeof captureIo>, rows: string[], number: string | undefined): string {
  return numberedRowOrFail(io, "o/r#1", {
    name: "thing",
    command: "make",
    total: rows.length,
    number,
    newest: () => rows.at(-1),
    get: (n) => rows[n - 1],
  });
}

describe("numberedRowOrFail", () => {
  it("returns the newest row when the number is undefined and writes nothing", () => {
    const io = captureIo();

    expect(rowOf(io, ["a", "b"], undefined)).toBe("b");
    expect(io.out).toEqual([]);
    expect(io.err).toEqual([]);
  });

  it("returns the row with the number", () => {
    const io = captureIo();

    expect(rowOf(io, ["a", "b"], "1")).toBe("a");
    expect(io.err).toEqual([]);
  });

  it.each([undefined, "2"])("stops the command with exit code 1 when there are no rows, for %s", (number) => {
    const io = captureIo();

    const error = thrownBy(() => rowOf(io, [], number));

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(1);
    expect(io.err).toEqual(["the task of o/r#1 has no thing; run tasker make first\n"]);
    expect(io.out).toEqual([]);
  });

  it("stops the command with exit code 1 for a number above the total", () => {
    const io = captureIo();

    const error = thrownBy(() => rowOf(io, ["a", "b"], "3"));

    expect((error as CommanderError).exitCode).toBe(1);
    expect(io.err).toEqual(["the task of o/r#1 has no thing 3; it has 2\n"]);
    expect(io.out).toEqual([]);
  });

  it("prints a very large number as typed", () => {
    const io = captureIo();
    const huge = "9".repeat(30);

    thrownBy(() => rowOf(io, ["a"], huge));

    expect(io.err).toEqual([`the task of o/r#1 has no thing ${huge}; it has 1\n`]);
  });
});
