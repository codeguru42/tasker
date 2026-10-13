import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli.js";
import { start } from "../../src/commands/start.js";
import { bootstrapLogPath } from "../../src/phases/bootstrap.js";
import { createDataRoot, taskLogsDir } from "../../src/store/layout.js";
import { openStore } from "../../src/store/store.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { captureIo, dayAt, lockNames, runCommand, seedTasks, taskNames, useStartFixture, useTempDir } from "../helpers.js";

const KEY = "codeguru42/tasker#5";

// The events of the only task of the issue, as { type, data }.
function eventsOf(dataRoot: string): { type: string; data: unknown }[] {
  const store = openStore(createDataRoot(dataRoot).database);
  try {
    const task = store.findLatestTask("codeguru42/tasker", KEY);
    if (task === undefined) throw new Error("no task");
    return store.listEvents(task.id).map(({ type, data }) => ({ type, data }));
  } finally {
    store.close();
  }
}

// Makes sure that the task failed in provisioning with an error, and that stderr holds the notes
// that came before the error, then that error.
// Gives the error.
function expectFailed(dataRoot: string, result: { code: number; err: string }, notes = ""): string {
  expect(result.code).toBe(1);
  const store = openStore(createDataRoot(dataRoot).database);
  try {
    const task = store.findLatestTask("codeguru42/tasker", KEY);
    expect(task?.state).toBe("failed");
    const last = store.listEvents(task!.id).at(-1);
    expect(last?.type).toBe("transition");
    const data = last?.data as { from: string; to: string; error: string };
    expect(data).toMatchObject({ from: "provisioning", to: "failed" });
    expect(result.err).toBe(`${notes}${data.error}\n`);
    expect(lockNames(dataRoot)).toEqual([]);
    return data.error;
  } finally {
    store.close();
  }
}

describe("start", () => {
  it("takes a new task to workspace_ready", async () => {
    const fixture = await useStartFixture({
      repo: { bootstrap: { commands: ["touch bootstrap.ran"], env: [] } },
    });
    const { dataRoot, repoKey } = fixture;
    const names = taskNames(repoPaths(dataRoot, repoKey).worktrees, 5, "Issue 5");

    const result = await runCommand(start, "start", KEY);

    expect(result).toEqual({
      code: 0,
      err: "tasker saved main as the default base branch of codeguru42/tasker.\n",
      out:
        "issue: codeguru42/tasker#5\n" +
        "repo: codeguru42/tasker\n" +
        "state: workspace_ready\n" +
        "base: main\n" +
        `branch: ${names.branch}\n` +
        `worktree: ${names.worktree}\n`,
    });
    expect(existsSync(join(names.worktree, "bootstrap.ran"))).toBe(true);
    const events = eventsOf(dataRoot);
    expect(events.map((event) => event.type)).toEqual([
      "created",
      "base",
      "workspace",
      "bootstrap",
      "transition",
    ]);
    expect(events[1].data).toMatchObject({ base: "main", source: "config" });
    expect(events[2].data).toMatchObject({ path: names.worktree, taskRef: names.branch, state: "created" });
    expect(events[3].data).toMatchObject({ status: "ok" });
    expect(events[4].data).toMatchObject({ from: "provisioning", to: "workspace_ready" });
    expect(lockNames(dataRoot)).toEqual([]);
  });

  it("uses the learned default base when the configuration has none", async () => {
    const fixture = await useStartFixture({ repo: { defaultBaseBranch: undefined } });
    await fixture.origin.createBranch("dev");
    const store = openStore(createDataRoot(fixture.dataRoot).database);
    try {
      store.setDefaultBaseBranch(fixture.repoKey, "dev");
    } finally {
      store.close();
    }

    const result = await runCommand(start, "start", KEY);

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: dev\n");
    expect(eventsOf(fixture.dataRoot)[1].data).toMatchObject({ base: "dev", source: "learned" });
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("uses the base label of the issue and does not learn it", async () => {
    const fixture = await useStartFixture({
      issues: [{ project: "codeguru42/tasker", number: 5, labels: ["base: dev"] }],
    });
    await fixture.origin.createBranch("dev");

    const result = await runCommand(start, "start", KEY);

    expect(result).toMatchObject({ code: 0, err: "" });
    expect(result.out).toContain("base: dev\n");
    expect(eventsOf(fixture.dataRoot)[1].data).toMatchObject({ base: "dev", source: "hint" });
    const store = openStore(createDataRoot(fixture.dataRoot).database);
    try {
      expect(store.getDefaultBaseBranch(fixture.repoKey)).toBeUndefined();
    } finally {
      store.close();
    }
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("uses --base as the explicit base", async () => {
    const fixture = await useStartFixture();
    await fixture.origin.createBranch("dev");

    const result = await runCommand(start, "start", KEY, "--base", "dev");

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: dev\n");
    expect(eventsOf(fixture.dataRoot)[1].data).toMatchObject({ base: "dev", source: "explicit" });
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("asks for the base in a terminal and learns the answer", async () => {
    const fixture = await useStartFixture({ repo: { defaultBaseBranch: undefined } });
    const io = captureIo({ answers: ["main"] });

    const code = await run(["start", KEY], { commands: [start], io });

    expect(code).toBe(0);
    expect(io.questions).toEqual(["Base branch for codeguru42/tasker: "]);
    expect(io.out.join("")).toContain("base: main\n");
    expect(eventsOf(fixture.dataRoot)[1].data).toMatchObject({ base: "main", source: "ask" });
    const store = openStore(createDataRoot(fixture.dataRoot).database);
    try {
      expect(store.getDefaultBaseBranch(fixture.repoKey)).toBe("main");
    } finally {
      store.close();
    }
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("fails with no base and no terminal", async () => {
    const fixture = await useStartFixture({ repo: { defaultBaseBranch: undefined } });

    const result = await runCommand(start, "start", KEY);

    expect(expectFailed(fixture.dataRoot, result)).toBe(
      "no base branch for codeguru42/tasker: pass --base <branch>, or set repos.codeguru42/tasker.defaultBaseBranch",
    );
  });

  it("fails the task when the provision fails", async () => {
    const fixture = await useStartFixture({ remote: "/nonexistent/origin.git" });

    const result = await runCommand(start, "start", KEY);

    expectFailed(fixture.dataRoot, result);
  });

  it("fails the task for a base that does not exist", async () => {
    const fixture = await useStartFixture();

    const result = await runCommand(start, "start", KEY, "--base", "nope");

    expect(expectFailed(fixture.dataRoot, result)).toBe(
      "the base branch does not exist: nope (from --base)",
    );
  });

  it("fails the task for two base labels", async () => {
    const fixture = await useStartFixture({
      issues: [{ project: "codeguru42/tasker", number: 5, labels: ["base: dev", "base: main"] }],
    });

    const result = await runCommand(start, "start", KEY);

    expect(expectFailed(fixture.dataRoot, result)).toContain(
      "the issue codeguru42/tasker#5 has more than one base: label",
    );
  });

  it("fails the task when the workspace cannot be made", async () => {
    const fixture = await useStartFixture();
    const { worktree } = taskNames(repoPaths(fixture.dataRoot, fixture.repoKey).worktrees, 5, "Issue 5");
    mkdirSync(dirname(worktree), { recursive: true });
    writeFileSync(worktree, "in the way");

    const result = await runCommand(start, "start", KEY);

    expectFailed(fixture.dataRoot, result, "tasker saved main as the default base branch of codeguru42/tasker.\n");
    expect(eventsOf(fixture.dataRoot).map((event) => event.type)).toEqual([
      "created",
      "base",
      "transition",
    ]);
  });

  it("fails the task when bootstrap fails and prints the tail of the log", async () => {
    const tmp = useTempDir("tasker-bootstrap-");
    const command = `seq 1 30; test -f ${tmp}/ok || exit 3`;
    const fixture = await useStartFixture({ repo: { bootstrap: { commands: [command], env: [] } } });

    const result = await runCommand(start, "start", KEY);

    const log = bootstrapLogPath(taskLogsDir(fixture.dataRoot, { issueKey: KEY, attempt: 1 }));
    const error = `bootstrap command 1 failed: ${command}: exit code 3. The log is ${log}.`;
    const tail = Array.from({ length: 19 }, (_, i) => `${i + 12}\n`).join("");
    expect(result.err).toBe(
      "tasker saved main as the default base branch of codeguru42/tasker.\n" +
        `${error}\nthe last 20 lines of the log:\n${tail}--- exit code 3\n`,
    );
    const events = eventsOf(fixture.dataRoot);
    expect(events.map((event) => event.type)).toEqual([
      "created",
      "base",
      "workspace",
      "bootstrap",
      "transition",
    ]);
    expect(events[3].data).toMatchObject({ status: "failed", index: 1, exitCode: 3, log });
    expect(events[4].data).toMatchObject({ from: "provisioning", to: "failed", error });
    expect(result.code).toBe(1);
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  describe("a second run", () => {
    // A repo with a bootstrap that fails until the file <tmp>/ok exists.
    async function failingFixture() {
      const tmp = useTempDir("tasker-second-run-");
      const command = `test -f ${tmp}/ok || exit 3`;
      const fixture = await useStartFixture({ repo: { bootstrap: { commands: [command], env: [] } } });
      return { fixture, ok: join(tmp, "ok") };
    }

    it("continues a task that failed in bootstrap", async () => {
      const { fixture, ok } = await failingFixture();
      expect((await runCommand(start, "start", KEY)).code).toBe(1);
      writeFileSync(ok, "");

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      expect(result.out).toContain("state: workspace_ready\n");
      const events = eventsOf(fixture.dataRoot);
      expect(events.filter((event) => event.type === "created")).toHaveLength(1);
      expect(events.find((event) => event.type === "transition" && (event.data as { from: string }).from === "failed")?.data)
        .toMatchObject({ from: "failed", to: "provisioning" });
      expect(events.filter((event) => event.type === "workspace").at(-1)?.data).toMatchObject({
        state: "reused-workspace",
      });
      const log = bootstrapLogPath(taskLogsDir(fixture.dataRoot, { issueKey: KEY, attempt: 1 }));
      expect(readFileSync(log, "utf8").match(/=== bootstrap run /g)).toHaveLength(2);
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    });

    it("continues a task that is still in provisioning", async () => {
      const fixture = await useStartFixture();
      const [seeded] = seedTasks(fixture.dataRoot, [
        { issueKey: KEY, repoKey: fixture.repoKey, state: "provisioning", at: dayAt(1), title: "Issue 5" },
      ]);

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      const store = openStore(createDataRoot(fixture.dataRoot).database);
      try {
        expect(store.findLatestTask(fixture.repoKey, KEY)).toMatchObject({
          id: seeded.id,
          state: "workspace_ready",
        });
      } finally {
        store.close();
      }
      expect(eventsOf(fixture.dataRoot).filter((event) => event.type === "created")).toHaveLength(1);
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    });

    it("keeps the stored base when the second run has no --base", async () => {
      const { fixture, ok } = await failingFixture();
      await fixture.origin.createBranch("dev");
      expect((await runCommand(start, "start", KEY, "--base", "dev")).code).toBe(1);
      writeFileSync(ok, "");

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      expect(result.out).toContain("base: dev\n");
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    });

    it("takes a new --base on the second run", async () => {
      const { fixture, ok } = await failingFixture();
      await fixture.origin.createBranch("dev");
      expect((await runCommand(start, "start", KEY, "--base", "dev")).code).toBe(1);
      writeFileSync(ok, "");

      const result = await runCommand(start, "start", KEY, "--base", "main");

      expect(result.code).toBe(0);
      expect(result.out).toContain("base: main\n");
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    });
  });

  describe("a task that is already started", () => {
    it("prints the task again after a success and changes nothing", async () => {
      const fixture = await useStartFixture();
      const first = await runCommand(start, "start", KEY);
      const count = eventsOf(fixture.dataRoot).length;

      const second = await runCommand(start, "start", KEY);

      expect(second.code).toBe(0);
      expect(second.out).toBe(`task already started\n${first.out}`);
      expect(eventsOf(fixture.dataRoot)).toHaveLength(count);
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    });

    it("leaves a task that failed after provisioning as it is", async () => {
      const fixture = await useStartFixture();
      seedTasks(fixture.dataRoot, [
        {
          issueKey: KEY,
          repoKey: fixture.repoKey,
          state: "workspace_ready",
          at: dayAt(1),
          title: "Issue 5",
          failWith: "boom",
        },
      ]);

      const result = await runCommand(start, "start", KEY);

      expect(result).toEqual({
        code: 0,
        err: "",
        out:
          "task already started\n" +
          "issue: codeguru42/tasker#5\n" +
          "repo: codeguru42/tasker\n" +
          "state: failed\n" +
          "base: -\n" +
          "branch: -\n" +
          "worktree: -\n",
      });
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    });
  });

  it("prints the description of the command and of both options for --help", async () => {
    const { code, out } = await runCommand(start, "start", "--help");

    expect(code).toBe(0);
    // Commander wraps the long lines of the help, so compare with single spaces.
    const help = out.replace(/\s+/g, " ");
    expect(help).toContain(
      "Make a task for an issue and take it to workspace_ready: read the issue, make the clone, resolve the base, make the worktree and run bootstrap",
    );
    expect(help).toContain(
      "Use the repo with this key when two repos share the project of the issue",
    );
    expect(help).toContain(
      "The base branch of this task only: a branch on origin, or refs/heads/<branch> for a local branch of the clone",
    );
  });
});
