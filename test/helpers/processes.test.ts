import { spawn, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { useTempDir } from "./temp.js";
import { validConfig, writeTempConfig } from "./config.js";
import { withRawDatabase } from "./store.js";
import {
  deadPid,
  isAlive,
  readPidFile,
  savePid,
  signalListenerCounts,
  spawnTasker,
  startFixture,
  startWriteLockHolder,
  waitForWatching,
  waitUntil,
  waitUntilGone,
} from "./processes.js";

describe("isAlive", () => {
  it("is true for the running test process", () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it("is false for a process that finished", () => {
    const finished = spawnSync("true");

    expect(finished.pid).toBeGreaterThan(0);
    expect(isAlive(finished.pid)).toBe(false);
  });
});

describe("deadPid", () => {
  it("gives the pid of a process that is gone", () => {
    expect(isAlive(deadPid())).toBe(false);
  });

  it("never gives the pid of the test process", () => {
    expect(deadPid()).not.toBe(process.pid);
  });
});

describe("waitUntil", () => {
  it("resolves when the predicate becomes true", async () => {
    let flag = false;
    setTimeout(() => {
      flag = true;
    }, 100);

    await expect(waitUntil(() => flag, 5000, "never")).resolves.toBeUndefined();
  });

  it("rejects with the message when the predicate stays false", async () => {
    await expect(waitUntil(() => false, 150, "the flag stayed false")).rejects.toThrow("the flag stayed false");
  });
});

describe("waitUntilGone", () => {
  it("resolves when the process ends", async () => {
    const child = spawn("sleep", ["0.2"], { stdio: "ignore" });
    savePid(child.pid!);

    await expect(waitUntilGone(child.pid!, 5000)).resolves.toBeUndefined();
  });

  it("rejects with the pid when the process stays", async () => {
    await expect(waitUntilGone(process.pid, 100)).rejects.toThrow(String(process.pid));
  });
});

describe("savePid", () => {
  let pid = 0;

  it("saves a pid that the test started", () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    expect(child.pid).toBeDefined();
    pid = child.pid!;
    savePid(pid);

    expect(isAlive(pid)).toBe(true);
  });

  it("kills the saved pid after the test", async () => {
    expect(pid).toBeGreaterThan(0);

    await expect(waitUntilGone(pid, 2000)).resolves.toBeUndefined();
  });

  it("ignores a saved pid that ends between the check and the kill", () => {
    const gone = deadPid();
    const realKill = process.kill.bind(process);
    const spy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid !== gone) return realKill(pid, signal);
      if (signal === 0) return true;
      throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH", errno: -3, syscall: "kill" });
    });
    onTestFinished(() => spy.mockRestore());

    savePid(gone);
  });
});

describe("readPidFile", () => {
  it("waits for the pid, returns it and saves it", async () => {
    const path = join(useTempDir("tasker-pid-file-"), "pid");
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    savePid(child.pid!);
    setTimeout(() => writeFileSync(path, `${child.pid}\n`), 100);

    await expect(readPidFile(path, 5000)).resolves.toBe(child.pid);
    expect(isAlive(child.pid!)).toBe(true);
  });

  it("rejects when no file appears", async () => {
    const path = join(useTempDir("tasker-pid-file-"), "pid");

    await expect(readPidFile(path, 150)).rejects.toThrow();
  });
});

describe("waitForWatching", () => {
  it("waits for the pid in the file watching of the folder", async () => {
    const dir = useTempDir("tasker-watching-");
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    savePid(child.pid!);
    setTimeout(() => writeFileSync(join(dir, "watching"), `${child.pid}\n`), 100);

    await expect(waitForWatching(dir, 5000)).resolves.toBe(child.pid);
  });

  it("rejects when the folder has no file watching", async () => {
    await expect(waitForWatching(useTempDir("tasker-watching-"), 150)).rejects.toThrow();
  });
});

describe("signalListenerCounts", () => {
  it("counts the SIGINT and SIGTERM listeners of this process", () => {
    const before = signalListenerCounts();
    const noop = () => {};
    process.on("SIGINT", noop);
    process.on("SIGTERM", noop);
    onTestFinished(() => {
      process.off("SIGINT", noop);
      process.off("SIGTERM", noop);
    });

    expect(signalListenerCounts()).toEqual([before[0]! + 1, before[1]! + 1]);
  });
});

describe("startFixture", () => {
  it("resolves with the first line of stdout", async () => {
    const dbPath = join(useTempDir("tasker-fixture-"), "tasker.db");

    await expect(startFixture("lock-holder.ts", [dbPath, "test-lock"]).firstLine).resolves.toBe(
      JSON.stringify({ held: true }),
    );
  });

  it("rejects with the stderr when the child ends first", async () => {
    const dbPath = join(useTempDir("tasker-fixture-"), "missing", "tasker.db");

    await expect(startFixture("lock-holder.ts", [dbPath, "test-lock"]).firstLine).rejects.toThrow(
      "unable to open database file",
    );
  });
});

describe("startWriteLockHolder", () => {
  it("resolves when the child holds the write lock", async () => {
    const dbPath = join(useTempDir("tasker-write-lock-"), "tasker.db");
    await startWriteLockHolder(dbPath, 60_000);
    withRawDatabase(dbPath, (db) => expect(() => db.exec("BEGIN IMMEDIATE")).toThrow("database is locked"));
  });

  it("rejects with the stderr when the child ends first", async () => {
    const dbPath = join(useTempDir("tasker-write-lock-"), "missing", "tasker.db");

    await expect(startWriteLockHolder(dbPath, 0)).rejects.toThrow("unable to open database file");
  });
});

describe("spawnTasker", () => {
  it("passes the env to the child and gives its stdout whole", async () => {
    const text = "€".repeat(50_000);
    const raw = validConfig();
    raw.repos.tasker.bootstrap = { commands: [text], env: [] };
    const { dir, path } = writeTempConfig(raw);
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

    const result = await spawnTasker(["show-config"], { TASKER_CONFIG: path });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).repos.tasker.bootstrap.commands).toEqual([text]);
  });

  it("gives the stderr of the child", async () => {
    const path = join(useTempDir("tasker-spawn-missing-"), "missing.json");

    const result = await spawnTasker(["show-config"], { TASKER_CONFIG: path });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`config file not found: ${path}`);
  });
});
