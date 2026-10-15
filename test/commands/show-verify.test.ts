import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { showVerify } from "../../src/commands/show-verify.js";
import { verifyCommandLogPath } from "../../src/store/layout.js";
import type { NewVerifyRun } from "../../src/store/store.js";
import { runCommand } from "../helpers/cli.js";
import { useThreeRepoDataRoot } from "../helpers/config.js";
import { dayAt, seedTasks, seedVerifyRun, withDataRootStore } from "../helpers/store.js";

const TASKER = "codeguru42/tasker";
const KEY = `${TASKER}#5`;

// Runs tasker show-verify for key, with the repo of key as --repo, then the extra arguments.
function showVerifyOf(key: string, ...extra: string[]) {
  return runCommand(showVerify, "show-verify", key, "--repo", key.split("#")[0], ...extra);
}

// A task of KEY with the given verify runs, each seeded with seedVerifyRun.
function seedRuns(runs: { change?: Partial<Omit<NewVerifyRun, "number">>; logs?: string[] }[] = []) {
  const { dataRoot } = useThreeRepoDataRoot();
  const [task] = seedTasks(dataRoot, [{ issueKey: KEY, repoKey: TASKER, state: "executed", at: dayAt(2) }]);
  withDataRootStore(dataRoot, (store) =>
    runs.forEach((r) => seedVerifyRun(store, dataRoot, task, r.change, r.logs, "failed")),
  );
  return { dataRoot, task };
}

describe("show-verify", () => {
  it("prints the newest run by default", async () => {
    const { dataRoot, task } = seedRuns([
      { change: { startedAt: dayAt(2) }, logs: ["$ npm ci\n--- exit code 0\n"] },
      {
        change: { result: "failed", commands: ["npm ci", "npm run check"], failingCommand: 2, startedAt: dayAt(3) },
        logs: ["$ npm ci\n--- exit code 0\n", "$ npm run check\n--- exit code 1\n"],
      },
    ]);
    const path1 = verifyCommandLogPath(dataRoot, task, 2, 1);
    const path2 = verifyCommandLogPath(dataRoot, task, 2, 2);

    const result = await showVerifyOf(KEY);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        `${KEY} verify run 2 of 2: failed (${dayAt(3)})\n` +
        `\n== command 1: npm ci (${path1}) ==\n$ npm ci\n--- exit code 0\n` +
        `\n== command 2: npm run check (${path2}) ==\n$ npm run check\n--- exit code 1\n`,
    });
  });

  it("prints the result as it is stored", async () => {
    seedRuns([{ change: { result: "dirty_after" } }]);

    const result = await showVerifyOf(KEY);

    expect(result.code).toBe(0);
    expect(result.out.split("\n")[0]).toBe(`${KEY} verify run 1 of 1: dirty_after (${dayAt(1)})`);
  });

  it("adds a final line end to a log that has none, and keeps one that has it", async () => {
    const { dataRoot, task } = seedRuns([
      { change: { commands: ["a", "b"] }, logs: ["no end", "has end\n"] },
    ]);
    const path1 = verifyCommandLogPath(dataRoot, task, 1, 1);
    const path2 = verifyCommandLogPath(dataRoot, task, 1, 2);

    const result = await showVerifyOf(KEY);

    expect(result.out).toBe(
      `${KEY} verify run 1 of 1: passed (${dayAt(1)})\n` +
        `\n== command 1: a (${path1}) ==\nno end\n` +
        `\n== command 2: b (${path2}) ==\nhas end\n`,
    );
  });

  it("prints the no logs line for a run that ran no command", async () => {
    seedRuns([{ change: { result: "dirty_before", commands: [] } }]);

    const result = await showVerifyOf(KEY);

    expect(result).toEqual({
      code: 0,
      err: "",
      out: `${KEY} verify run 1 of 1: dirty_before (${dayAt(1)})\n\nno logs: this run ran no command\n`,
    });
  });

  it.each([[[]], [["--run", "2"]]])("fails for a task with no verify run (extra arguments %j)", async (extra) => {
    seedRuns();

    const result = await showVerifyOf(KEY, ...extra);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `the task of ${KEY} has no verify run; run tasker verify first\n`,
    });
  });

  it("fails for an issue with no task", async () => {
    seedRuns();

    const result = await showVerifyOf("codeguru42/other#9");

    expect(result).toEqual({
      code: 1,
      out: "",
      err: "no task for the issue codeguru42/other#9 in the repo codeguru42/other\n",
    });
  });

  it("prints run 1 of 2 with --run 1", async () => {
    const { dataRoot, task } = seedRuns([
      { change: { result: "failed", startedAt: dayAt(2) }, logs: ["one\n"] },
      { change: { result: "passed", startedAt: dayAt(3) }, logs: ["two\n"] },
    ]);
    const path = verifyCommandLogPath(dataRoot, task, 1, 1);

    const result = await showVerifyOf(KEY, "--run", "1");

    expect(result).toEqual({
      code: 0,
      err: "",
      out: `${KEY} verify run 1 of 2: failed (${dayAt(2)})\n\n== command 1: npm run check (${path}) ==\none\n`,
    });
  });

  it.each(["0", "01", "-1", "1.5"])("fails for the bad --run value %s", async (value) => {
    seedRuns([{}]);

    const result = await showVerifyOf(KEY, "--run", value);

    expect(result).toEqual({ code: 1, out: "", err: `--run must be a whole number of 1 or more: ${value}\n` });
  });

  it("checks --run before the task lookup", async () => {
    const written = useThreeRepoDataRoot();

    const result = await showVerifyOf("nobody/else#1", "--run", "0");

    expect(result).toEqual({ code: 1, out: "", err: "--run must be a whole number of 1 or more: 0\n" });
    expect(existsSync(join(written.dataRoot, "tasker.db"))).toBe(false);
  });

  it("fails for a run that does not exist", async () => {
    seedRuns([{}, {}]);

    const result = await showVerifyOf(KEY, "--run", "3");

    expect(result).toEqual({ code: 1, out: "", err: `the task of ${KEY} has no verify run 3; it has 2\n` });
  });

  it("prints a very large --run as the user typed it", async () => {
    seedRuns([{}]);
    const value = "9".repeat(30);

    const result = await showVerifyOf(KEY, "--run", value);

    expect(result).toEqual({ code: 1, out: "", err: `the task of ${KEY} has no verify run ${value}; it has 1\n` });
  });

  it("prints the header and only the block of --command", async () => {
    const { dataRoot, task } = seedRuns([{ change: { commands: ["a", "b"] }, logs: ["log a\n", "log b\n"] }]);
    const path = verifyCommandLogPath(dataRoot, task, 1, 2);

    const result = await showVerifyOf(KEY, "--command", "2");

    expect(result).toEqual({
      code: 0,
      err: "",
      out: `${KEY} verify run 1 of 1: passed (${dayAt(1)})\n\n== command 2: b (${path}) ==\nlog b\n`,
    });
  });

  it("combines --run and --command", async () => {
    const { dataRoot, task } = seedRuns([
      { change: { commands: ["a"] }, logs: ["first\n"] },
      { change: { commands: ["b"] }, logs: ["second\n"] },
    ]);
    const path = verifyCommandLogPath(dataRoot, task, 1, 1);

    const result = await showVerifyOf(KEY, "--run", "1", "--command", "1");

    expect(result).toEqual({
      code: 0,
      err: "",
      out: `${KEY} verify run 1 of 2: passed (${dayAt(1)})\n\n== command 1: a (${path}) ==\nfirst\n`,
    });
  });

  it.each(["0", "01", "-1", "1.5"])("fails for the bad --command value %s", async (value) => {
    seedRuns([{}]);

    const result = await showVerifyOf(KEY, "--command", value);

    expect(result).toEqual({ code: 1, out: "", err: `--command must be a whole number of 1 or more: ${value}\n` });
  });

  it("reports a bad --run and a bad --command together", async () => {
    seedRuns([{}]);

    const result = await showVerifyOf(KEY, "--run", "0", "--command", "01");

    expect(result).toEqual({
      code: 1,
      out: "",
      err:
        "--run must be a whole number of 1 or more: 0\n" + "--command must be a whole number of 1 or more: 01\n",
    });
  });

  it("fails for a command that the run did not start", async () => {
    seedRuns([{ change: { commands: ["a", "b"] } }]);

    const result = await showVerifyOf(KEY, "--command", "3");

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `verify run 1 of ${KEY} has no log for command 3; it ran 2 commands\n`,
    });
  });

  it("prints only the started commands of a run that the deadline stopped", async () => {
    const { dataRoot, task } = seedRuns([
      {
        change: { result: "timed_out", commands: ["a", "b"], failingCommand: 3 },
        logs: ["log a\n", "log b\n"],
      },
    ]);
    const path1 = verifyCommandLogPath(dataRoot, task, 1, 1);
    const path2 = verifyCommandLogPath(dataRoot, task, 1, 2);

    const all = await showVerifyOf(KEY);
    const third = await showVerifyOf(KEY, "--command", "3");

    expect(all.out).toBe(
      `${KEY} verify run 1 of 1: timed_out (${dayAt(1)})\n` +
        `\n== command 1: a (${path1}) ==\nlog a\n\n== command 2: b (${path2}) ==\nlog b\n`,
    );
    expect(third).toEqual({
      code: 1,
      out: "",
      err: `verify run 1 of ${KEY} has no log for command 3; it ran 2 commands\n`,
    });
  });

  it("prints every block and exits with code 1 when a log cannot be read", async () => {
    const { dataRoot, task } = seedRuns([
      { change: { commands: ["a", "b", "c"] }, logs: ["log a\n", "log b\n", "log c\n"] },
    ]);
    const [path1, path2, path3] = [1, 2, 3].map((position) => verifyCommandLogPath(dataRoot, task, 1, position));
    rmSync(path2);
    mkdirSync(path2);

    const result = await showVerifyOf(KEY);

    expect(result).toEqual({
      code: 1,
      err: "",
      out:
        `${KEY} verify run 1 of 1: passed (${dayAt(1)})\n` +
        `\n== command 1: a (${path1}) ==\nlog a\n` +
        `\n== command 2: b (${path2}) ==\n(log not readable: EISDIR)\n` +
        `\n== command 3: c (${path3}) ==\nlog c\n`,
    });
  });
});
