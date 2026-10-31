import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli.js";
import { start } from "../../src/commands/start.js";
import { bootstrapLogPath } from "../../src/phases/bootstrap.js";
import type { TaskState } from "../../src/state/machine.js";
import { repoLockName, taskLockName } from "../../src/store/locks.js";
import { createDataRoot, taskLogsDir } from "../../src/store/layout.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { captureIo, runCommand, runHelp } from "../helpers/cli.js";
import {
  blockerReadCalls,
  blockersGraphqlArgs,
  ghTokenAnswer,
  githubBlockersAnswer,
  trackerWriteCalls,
  writeFakeGh,
} from "../helpers/fake-gh.js";
import { commitInWorktree, gitOutput, taskNames } from "../helpers/git.js";
import { spawnTasker, startLockHolder, waitUntil, waitUntilGone } from "../helpers/processes.js";
import {
  dayAt,
  eventDataOf,
  eventsOf,
  latestTaskOf,
  lockNames,
  placeTask,
  seedTasks,
  withDataRootStore,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  fixtureTrackerAnswer,
  fixtureTrackerCall,
  startIssueTask,
  trackerRepo,
  useStartFixture,
} from "../helpers/task-fixtures.js";
import { useTempDir, writeFileWithParents } from "../helpers/temp.js";

const KEY = "codeguru42/tasker#5";
const PROJECT = "codeguru42/tasker";

// Makes sure that the task failed in provisioning with an error, and that stderr holds the notes
// that came before the error, then that error.
// Gives the error.
function expectFailed(dataRoot: string, result: { code: number; err: string }, notes = ""): string {
  expect(result.code).toBe(1);
  return withDataRootStore(dataRoot, (store) => {
    const task = store.findLatestTask("codeguru42/tasker", KEY);
    expect(task?.state).toBe("failed");
    const last = store.listEvents(task!.id).at(-1);
    expect(last?.type).toBe("transition");
    const data = last?.data as { from: string; to: string; error: string };
    expect(data).toMatchObject({ from: "provisioning", to: "failed" });
    expect(result.err).toBe(`${notes}${data.error}\n`);
    expect(lockNames(dataRoot)).toEqual([]);
    return data.error;
  });
}

function taskState(dataRoot: string, key = KEY): string | undefined {
  return withDataRootStore(dataRoot, (store) => {
    return store.findLatestTask("codeguru42/tasker", key)?.state;
  });
}

function hasTask(dataRoot: string): boolean {
  return taskState(dataRoot) !== undefined;
}

// The six field lines of the output of a new task.
function fieldLines(dataRoot: string): string {
  const names = taskNames(repoPaths(dataRoot, PROJECT).worktrees, 5, "Issue 5");
  return (
    `issue: ${KEY}\nrepo: ${PROJECT}\nstate: workspace_ready\nbase: main\n` +
    `branch: ${names.branch}\nworktree: ${names.worktree}\n`
  );
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
      out: fieldLines(dataRoot),
    });
    expect(existsSync(join(names.worktree, "bootstrap.ran"))).toBe(true);
    const events = eventsOf(dataRoot, KEY);
    expect(events.map((event) => event.type)).toEqual(["created", "base", "workspace", "bootstrap", "transition"]);
    expect(events[1].data).toMatchObject({ base: "main", source: "config" });
    expect(events[2].data).toMatchObject({ path: names.worktree, taskRef: names.branch, state: "created" });
    expect(events[3].data).toMatchObject({ status: "ok" });
    expect(events[4].data).toMatchObject({ from: "provisioning", to: "workspace_ready" });
    expect(lockNames(dataRoot)).toEqual([]);
  });

  it("uses the learned default base when the configuration has none", async () => {
    const fixture = await useStartFixture({ repo: { defaultBaseBranch: undefined } });
    await fixture.origin.createBranch("dev");
    withDataRootStore(fixture.dataRoot, (store) => {
      store.setDefaultBaseBranch(fixture.repoKey, "dev");
    });

    const result = await runCommand(start, "start", KEY);

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: dev\n");
    expect(eventsOf(fixture.dataRoot, KEY)[1].data).toMatchObject({ base: "dev", source: "learned" });
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
    expect(eventsOf(fixture.dataRoot, KEY)[1].data).toMatchObject({ base: "dev", source: "hint" });
    withDataRootStore(fixture.dataRoot, (store) => {
      expect(store.getDefaultBaseBranch(fixture.repoKey)).toBeUndefined();
    });
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("uses --base as the explicit base", async () => {
    const fixture = await useStartFixture();
    await fixture.origin.createBranch("dev");

    const result = await runCommand(start, "start", KEY, "--base", "dev");

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: dev\n");
    expect(eventsOf(fixture.dataRoot, KEY)[1].data).toMatchObject({ base: "dev", source: "explicit" });
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("lets --base win over a base: label", async () => {
    const fixture = await useStartFixture({
      issues: [{ project: "codeguru42/tasker", number: 5, labels: ["base: dev"] }],
    });
    await fixture.origin.createBranch("dev");

    const result = await runCommand(start, "start", KEY, "--base", "main");

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: main\n");
    expect(eventsOf(fixture.dataRoot, KEY)[1].data).toMatchObject({ base: "main", source: "explicit" });
  });

  it.each([[["base: dev", "base: main"]], [["base:"]]])("starts with --base and the bad labels %j", async (labels) => {
    await useStartFixture({ issues: [{ project: "codeguru42/tasker", number: 5, labels }] });

    const result = await runCommand(start, "start", KEY, "--base", "main");

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: main\n");
  });

  it("asks for the base in a terminal and learns the answer", async () => {
    const fixture = await useStartFixture({ repo: { defaultBaseBranch: undefined } });
    const io = captureIo({ answers: ["main"] });

    const code = await run(["start", KEY], { commands: [start], io });

    expect(code).toBe(0);
    expect(io.questions).toEqual(["Base branch for codeguru42/tasker: "]);
    expect(io.out.join("")).toContain("base: main\n");
    expect(eventsOf(fixture.dataRoot, KEY)[1].data).toMatchObject({ base: "main", source: "ask" });
    withDataRootStore(fixture.dataRoot, (store) => {
      expect(store.getDefaultBaseBranch(fixture.repoKey)).toBe("main");
    });
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("fails with no base and no terminal", async () => {
    const fixture = await useStartFixture({ repo: { defaultBaseBranch: undefined } });

    const result = await runCommand(start, "start", KEY);

    expect(expectFailed(fixture.dataRoot, result)).toBe(
      "no base branch for codeguru42/tasker: pass --base <branch> to tasker start, or set repos.codeguru42/tasker.defaultBaseBranch",
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

    expect(expectFailed(fixture.dataRoot, result)).toBe("the base branch does not exist: nope (from --base)");
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
    writeFileWithParents(worktree, "in the way");

    const result = await runCommand(start, "start", KEY);

    expectFailed(fixture.dataRoot, result, "tasker saved main as the default base branch of codeguru42/tasker.\n");
    expect(eventsOf(fixture.dataRoot, KEY).map((event) => event.type)).toEqual(["created", "base", "transition"]);
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
    const events = eventsOf(fixture.dataRoot, KEY);
    expect(events.map((event) => event.type)).toEqual(["created", "base", "workspace", "bootstrap", "transition"]);
    expect(events[3].data).toMatchObject({ status: "failed", index: 1, exitCode: 3, log });
    expect(events[4].data).toMatchObject({ from: "provisioning", to: "failed", error });
    expect(result.code).toBe(1);
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  describe("a second run", () => {
    // A repo with a bootstrap that fails until the file <tmp>/ok exists.
    // options.issues gives the issues that the fake gh answers.
    async function failingFixture(options: { issues?: { project: string; number: number; labels?: string[] }[] } = {}) {
      const tmp = useTempDir("tasker-second-run-");
      const command = `test -f ${tmp}/ok || exit 3`;
      const fixture = await useStartFixture({ ...options, repo: { bootstrap: { commands: [command], env: [] } } });
      return { fixture, ok: join(tmp, "ok") };
    }

    it("continues a task that failed in bootstrap", async () => {
      const { fixture, ok } = await failingFixture();
      expect((await runCommand(start, "start", KEY)).code).toBe(1);
      writeFileSync(ok, "");
      const task = latestTaskOf(fixture.dataRoot, KEY);
      const first = task.syncedBaseTip;
      const branchTip = await gitOutput(
        { gitDir: repoPaths(fixture.dataRoot, PROJECT).clone },
        fixture.origin.env,
        "rev-parse",
        `refs/heads/${String(task.branch)}`,
      );
      expect(first).toBe(branchTip);
      expect(eventsOf(fixture.dataRoot, KEY).find((event) => event.type === "workspace")?.data).toMatchObject({
        state: "created",
        syncedBaseTip: first,
      });
      await commitInWorktree(task.worktreePath!, fixture.origin.env, { file: "local.txt" });

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      expect(result.out).toContain("state: workspace_ready\n");
      expect(latestTaskOf(fixture.dataRoot, KEY).syncedBaseTip).toBe(first);
      const events = eventsOf(fixture.dataRoot, KEY);
      expect(events.filter((event) => event.type === "created")).toHaveLength(1);
      expect(
        events.find((event) => event.type === "transition" && (event.data as { from: string }).from === "failed")?.data,
      ).toMatchObject({ from: "failed", to: "provisioning" });
      expect(events.filter((event) => event.type === "workspace").at(-1)?.data).toMatchObject({
        state: "reused-workspace",
      });
      expect(events.filter((event) => event.type === "workspace").at(-1)?.data).not.toHaveProperty("syncedBaseTip");
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
      withDataRootStore(fixture.dataRoot, (store) => {
        expect(store.findLatestTask(fixture.repoKey, KEY)).toMatchObject({
          id: seeded.id,
          state: "workspace_ready",
        });
      });
      expect(eventsOf(fixture.dataRoot, KEY).filter((event) => event.type === "created")).toHaveLength(1);
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

    it("lets a base: label win over a stored --base", async () => {
      const { fixture, ok } = await failingFixture({
        issues: [{ project: PROJECT, number: 5, labels: ["base: dev"] }],
      });
      await fixture.origin.createBranch("dev");
      expect((await runCommand(start, "start", KEY, "--base", "main")).code).toBe(1);
      writeFileSync(ok, "");

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      expect(result.out).toContain("base: dev\n");
      const sources = eventsOf(fixture.dataRoot, KEY)
        .filter((event) => event.type === "base")
        .map((event) => (event.data as { source: string }).source);
      expect(sources).toEqual(["explicit", "hint"]);
    });

    describe("the parent of a stacked task", () => {
      const issues = [3, 5].map((number) => ({ project: PROJECT, number }));
      const PARENT = `${PROJECT}#3`;

      // Starts the parent (issue 3) while ok exists, then removes ok so that the next bootstrap fails.
      async function failingStackedFixture() {
        const { fixture, ok } = await failingFixture({ issues });
        writeFileSync(ok, "");
        const parent = await startIssueTask(fixture, 3);
        expect(parent.result.code).toBe(0);
        rmSync(ok);
        return { fixture, ok, parent, parentId: latestTaskOf(fixture.dataRoot, PARENT).id };
      }

      it("stores the link of a failed start and clears it when the second run has --base main", async () => {
        const { fixture, ok, parent, parentId } = await failingStackedFixture();
        expect((await runCommand(start, "start", KEY, "--base", `refs/heads/${parent.branch}`)).code).toBe(1);
        expect(latestTaskOf(fixture.dataRoot, KEY).parentTaskId).toBe(parentId);
        writeFileSync(ok, "");

        const result = await runCommand(start, "start", KEY, "--base", "main");

        expect(result.code).toBe(0);
        expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ base: "main", parentTaskId: null });
      });

      it("clears the link when the parent finished before the second run with no --base", async () => {
        const { fixture, ok, parent, parentId } = await failingStackedFixture();
        expect((await runCommand(start, "start", KEY, "--base", `refs/heads/${parent.branch}`)).code).toBe(1);
        expect(latestTaskOf(fixture.dataRoot, KEY).parentTaskId).toBe(parentId);
        withDataRootStore(fixture.dataRoot, (store) => placeTask(store, parentId, "finished"));
        writeFileSync(ok, "");

        const result = await runCommand(start, "start", KEY);

        expect(result.code).toBe(0);
        expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({
          base: `refs/heads/${parent.branch}`,
          parentTaskId: null,
        });
      });
    });
  });

  describe("a task that is already started", () => {
    it("prints the task again after a success and changes nothing", async () => {
      const fixture = await useStartFixture();
      const first = await runCommand(start, "start", KEY);
      const count = eventsOf(fixture.dataRoot, KEY).length;

      const second = await runCommand(start, "start", KEY);

      expect(second.code).toBe(0);
      expect(second.out).toBe(`task already started\n${first.out}`);
      expect(eventsOf(fixture.dataRoot, KEY)).toHaveLength(count);
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

  describe("an issue that cannot be started", () => {
    it("refuses a closed issue and makes no task", async () => {
      const fixture = await useStartFixture({
        issues: [{ project: "codeguru42/tasker", number: 5, state: "CLOSED" }],
      });

      const result = await runCommand(start, "start", KEY);

      expect(result).toEqual({ code: 1, out: "", err: "the issue is closed: codeguru42/tasker#5\n" });
      expect(hasTask(fixture.dataRoot)).toBe(false);
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    });

    it("gives the error of an issue that does not exist and makes no task", async () => {
      const fixture = await useStartFixture();
      const stderr = "GraphQL: Could not resolve to an issue or pull request with the number of 5.\n";
      writeFakeGh(join(dirname(fixture.gh.logPath), "bin"), fixture.gh.logPath, [
        ghTokenAnswer("codeguru42", "gho_test"),
        {
          args: ["issue", "view", "5", "-R", "codeguru42/tasker", "--json", "number,title,body,url,labels,state"],
          stderr,
          exitCode: 1,
        },
      ]);

      const result = await runCommand(start, "start", KEY);

      expect(result).toEqual({
        code: 1,
        out: "",
        err: `the issue ${KEY} does not exist: ${stderr.trim()}\n`,
      });
      expect(hasTask(fixture.dataRoot)).toBe(false);
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    });
  });

  describe("locks", () => {
    const REPO = "codeguru42/tasker";

    it("refuses at once when another process holds the task lock", async () => {
      const fixture = await useStartFixture();
      const name = taskLockName(REPO, KEY);
      const holder = startLockHolder(createDataRoot(fixture.dataRoot).database, name);
      await holder.attempt;

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(1);
      expect(result.err).toContain(`the lock ${name} is busy: process ${holder.pid}`);
      expect(hasTask(fixture.dataRoot)).toBe(false);
      expect(fixture.gh.calls().some((call) => call.args.includes("view"))).toBe(false);
      expect(lockNames(fixture.dataRoot)).toEqual([name]);
    });

    it("waits for the repo lock and goes on when the holder dies", async () => {
      const fixture = await useStartFixture();
      const holder = startLockHolder(createDataRoot(fixture.dataRoot).database, repoLockName(REPO));
      await holder.attempt;

      const running = runCommand(start, "start", KEY);
      await waitUntil(() => taskState(fixture.dataRoot) === "provisioning", 30_000, "the task did not appear");
      await new Promise((done) => setTimeout(done, 500));
      process.kill(holder.pid, "SIGKILL");
      await waitUntilGone(holder.pid, 10_000);

      const result = await running;
      expect(result.code).toBe(0);
      expect(taskState(fixture.dataRoot)).toBe("workspace_ready");
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    }, 60_000);

    it("runs bootstrap with only the task lock held", async () => {
      const tmp = useTempDir("tasker-lock-bootstrap-");
      const command =
        `touch ${tmp}/started; i=0; while [ ! -f ${tmp}/go ] && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done; ` +
        `test -f ${tmp}/go`;
      const fixture = await useStartFixture({ repo: { bootstrap: { commands: [command], env: [] } } });

      const running = runCommand(start, "start", KEY);
      await waitUntil(() => existsSync(join(tmp, "started")), 30_000, "bootstrap did not start");
      expect(lockNames(fixture.dataRoot)).toEqual([taskLockName(REPO, KEY)]);
      writeFileSync(join(tmp, "go"), "");

      const result = await running;
      expect(result.code).toBe(0);
      expect(taskState(fixture.dataRoot)).toBe("workspace_ready");
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    }, 60_000);

    it("runs two issues at the same time", async () => {
      const barrier = useTempDir("tasker-barrier-");
      const count = `$(ls ${barrier} | wc -l)`;
      const command =
        `touch ${barrier}/$$; i=0; while [ ${count} -lt 2 ] && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done; ` +
        `[ ${count} -ge 2 ]`;
      const fixture = await useStartFixture({
        issues: [
          { project: REPO, number: 5 },
          { project: REPO, number: 6 },
        ],
        repo: { bootstrap: { commands: [command], env: [] } },
      });

      const results = await Promise.all([spawnTasker(["start", `${REPO}#5`]), spawnTasker(["start", `${REPO}#6`])]);

      expect(results.map((result) => result.code)).toEqual([0, 0]);
      expect(taskState(fixture.dataRoot, `${REPO}#5`)).toBe("workspace_ready");
      expect(taskState(fixture.dataRoot, `${REPO}#6`)).toBe("workspace_ready");
      expect(lockNames(fixture.dataRoot)).toEqual([]);
    }, 120_000);
  });

  it("prints the description of the command and of all options for --help", async () => {
    const { code, help } = await runHelp(start, "start");

    expect(code).toBe(0);
    expect(help).toContain(
      "Make a task for an issue and take it to workspace_ready: read the issue, make the clone, resolve the base, make the worktree and run bootstrap",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
    expect(help).toContain(
      "The base branch of this task only: a branch on origin, or refs/heads/<branch> for a local branch of the clone",
    );
    expect(help).toContain("Start the task also when the issue already has the in-progress marker on the tracker");
  });

  describe("the tracker writes", () => {
    it("makes no write and no event when updateOnStart is false", async () => {
      const fixture = await useStartFixture({
        repo: trackerRepo({ updateOnStart: false, inProgressLabel: "in progress" }),
      });

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      expect(result.out).toBe(fieldLines(fixture.dataRoot));
      expect(trackerWriteCalls(fixture.gh)).toEqual([]);
      expect(eventDataOf(fixture.dataRoot, KEY, "tracker_update")).toEqual([]);
    });

    it("assigns the issue and adds the label after the fields, and records two ok events", async () => {
      const fixture = await useStartFixture({
        repo: trackerRepo({ updateOnStart: true, inProgressLabel: "in progress" }),
        ghAnswers: [fixtureTrackerAnswer("assign"), fixtureTrackerAnswer("inProgress")],
      });

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      expect(result.out).toBe(
        `${fieldLines(fixture.dataRoot)}assigned ${KEY} to @me on the tracker\nmarked ${KEY} in progress on the tracker\n`,
      );
      expect(trackerWriteCalls(fixture.gh)).toEqual([fixtureTrackerCall("assign"), fixtureTrackerCall("inProgress")]);
      const types = eventsOf(fixture.dataRoot, KEY).map((event) => event.type);
      expect(types.slice(-3)).toEqual(["transition", "tracker_update", "tracker_update"]);
      expect(eventDataOf(fixture.dataRoot, KEY, "tracker_update")).toEqual([
        { action: "assign", result: "ok" },
        { action: "in_progress", result: "ok" },
      ]);
    });

    it("only assigns the issue when there is no in-progress label", async () => {
      const fixture = await useStartFixture({
        repo: trackerRepo({ updateOnStart: true }),
        ghAnswers: [fixtureTrackerAnswer("assign")],
      });

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      expect(result.out).toBe(`${fieldLines(fixture.dataRoot)}assigned ${KEY} to @me on the tracker\n`);
      expect(trackerWriteCalls(fixture.gh)).toEqual([fixtureTrackerCall("assign")]);
      expect(eventDataOf(fixture.dataRoot, KEY, "tracker_update")).toEqual([{ action: "assign", result: "ok" }]);
    });

    it("warns for each failed write, exits with 0 and keeps the task in workspace_ready", async () => {
      const fixture = await useStartFixture({
        repo: trackerRepo({ updateOnStart: true, inProgressLabel: "in progress" }),
        ghAnswers: [
          fixtureTrackerAnswer("assign", { stderr: "cannot assign\nsecond line\n", exitCode: 1 }),
          fixtureTrackerAnswer("inProgress", { stderr: "cannot label\n", exitCode: 1 }),
        ],
      });

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      expect(result.out).toBe(fieldLines(fixture.dataRoot));
      const events = eventDataOf(fixture.dataRoot, KEY, "tracker_update") as {
        action: string;
        result: string;
        error: string;
      }[];
      expect(events).toEqual([
        { action: "assign", result: "failed", error: expect.stringContaining("cannot assign") },
        { action: "in_progress", result: "failed", error: expect.stringContaining("cannot label") },
      ]);
      expect(result.err).toContain(`warning: cannot assign ${KEY} to @me on the tracker: ${events[0].error}\n`);
      expect(result.err).toContain(`warning: cannot mark ${KEY} in progress on the tracker: ${events[1].error}\n`);
      expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("workspace_ready");
      expect(trackerWriteCalls(fixture.gh)).toEqual([fixtureTrackerCall("assign"), fixtureTrackerCall("inProgress")]);
    });
    describe("the in-progress marker", () => {
      const marked = { project: PROJECT, number: 5, labels: ["In Progress"] };
      const markerRepo = (updateOnStart: boolean) => trackerRepo({ updateOnStart, inProgressLabel: "in progress" });

      it("refuses an issue that has the marker and makes no task and no write", async () => {
        const fixture = await useStartFixture({ issues: [marked], repo: markerRepo(true) });

        const result = await runCommand(start, "start", KEY);

        expect(result).toEqual({
          code: 1,
          out: "",
          err: `the issue ${KEY} already has the in-progress marker in progress. Pass --reclaim to start it anyway, or remove the marker on the tracker.\n`,
        });
        expect(hasTask(fixture.dataRoot)).toBe(false);
        expect(trackerWriteCalls(fixture.gh)).toEqual([]);
      });

      it("starts the issue with --reclaim and runs both writes", async () => {
        const fixture = await useStartFixture({
          issues: [marked],
          repo: markerRepo(true),
          ghAnswers: [fixtureTrackerAnswer("assign"), fixtureTrackerAnswer("inProgress")],
        });

        const result = await runCommand(start, "start", KEY, "--reclaim");

        expect(result.code).toBe(0);
        expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("workspace_ready");
        expect(trackerWriteCalls(fixture.gh)).toEqual([fixtureTrackerCall("assign"), fixtureTrackerCall("inProgress")]);
      });

      it("makes no check and no write for a task that is already started", async () => {
        const fixture = await useStartFixture({ issues: [marked], repo: markerRepo(true) });
        seedTasks(fixture.dataRoot, [
          { issueKey: KEY, repoKey: fixture.repoKey, state: "workspace_ready", at: dayAt(1), title: "Issue 5" },
        ]);

        const result = await runCommand(start, "start", KEY);

        expect(result.code).toBe(0);
        expect(result.out).toContain("task already started\n");
        expect(trackerWriteCalls(fixture.gh)).toEqual([]);
      });

      it("starts the issue when updateOnStart is false", async () => {
        const fixture = await useStartFixture({ issues: [marked], repo: markerRepo(false) });

        const result = await runCommand(start, "start", KEY);

        expect(result.code).toBe(0);
        expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("workspace_ready");
        expect(trackerWriteCalls(fixture.gh)).toEqual([]);
      });
    });
  });
});

describe("the blocker step", () => {
  const BLOCKER = "codeguru42/tasker#3";
  const stillOpen = (key: string) => `${key}: blocking issue is still open\n`;
  const issues = [3, 4, 5].map((number) => ({ project: PROJECT, number }));
  const blockersOf = (...blockers: { number: number; state: "OPEN" | "CLOSED" }[]) =>
    githubBlockersAnswer({ project: PROJECT, number: 5, blockers });

  // Seeds the tasks of the issues 3 and 4 as ready tasks with a branch, with no checkout.
  function seedReady(dataRoot: string, numbers: number[]): void {
    seedTasks(
      dataRoot,
      numbers.map((number, index) => ({
        issueKey: `${PROJECT}#${number}`,
        repoKey: PROJECT,
        state: "awaiting_work_review",
        at: dayAt(index + 1),
        branch: `task-${number}`,
      })),
    );
  }

  it("keeps the normal base for blockers that are all closed", async () => {
    const fixture = await useStartFixture({
      issues,
      ghAnswers: [blockersOf({ number: 3, state: "CLOSED" }, { number: 4, state: "CLOSED" })],
    });

    const result = await runCommand(start, "start", KEY);

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: main\n");
    expect(eventDataOf(fixture.dataRoot, KEY, "base")).toEqual([
      expect.not.objectContaining({ blocker: expect.anything() }),
    ]);
  });

  it("bases the task on the branch of a ready blocker", async () => {
    const fixture = await useStartFixture({
      issues,
      ghAnswers: [blockersOf({ number: 3, state: "OPEN" })],
    });
    const parent = await startIssueTask(fixture, 3);
    withDataRootStore(fixture.dataRoot, (store) => {
      placeTask(store, store.findLatestTask(PROJECT, BLOCKER)!.id, "awaiting_work_review");
    });
    const base = `refs/heads/${parent.branch}`;

    const result = await runCommand(start, "start", KEY);

    expect(result.code).toBe(0);
    expect(result.out).toContain(`base: ${base}\n`);
    expect(result.err).toContain("based on codeguru42/tasker#3's branch\n");
    expect(eventDataOf(fixture.dataRoot, KEY, "base")).toEqual([
      { base, revision: base, source: "blocker", blocker: BLOCKER },
    ]);
    withDataRootStore(fixture.dataRoot, (store) => {
      expect(store.getDefaultBaseBranch(PROJECT)).toBe("main");
    });
    expect(latestTaskOf(fixture.dataRoot, KEY).parentTaskId).toBe(latestTaskOf(fixture.dataRoot, BLOCKER).id);
  });

  describe("the parent id of a task", () => {
    // Starts the task of issue 3 as the parent, moves it to state and gives it.
    async function startParent(fixture: Awaited<ReturnType<typeof useStartFixture>>, state: TaskState) {
      const parent = await startIssueTask(fixture, 3);
      expect(parent.result.code).toBe(0);
      const id = latestTaskOf(fixture.dataRoot, BLOCKER).id;
      withDataRootStore(fixture.dataRoot, (store) => placeTask(store, id, state));
      return { ...parent, id, base: `refs/heads/${parent.branch}` };
    }

    it("writes the id of the parent for a start with --base of its branch", async () => {
      const fixture = await useStartFixture({ issues });
      const parent = await startParent(fixture, "awaiting_work_review");

      const result = await runCommand(start, "start", KEY, "--base", parent.base);

      expect(result.code).toBe(0);
      expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ base: parent.base, parentTaskId: parent.id });
    });

    it("writes null for a start on a branch of origin", async () => {
      const fixture = await useStartFixture({ issues });

      const result = await runCommand(start, "start", KEY);

      expect(result.code).toBe(0);
      expect(latestTaskOf(fixture.dataRoot, KEY).parentTaskId).toBeNull();
    });

    it.each(["cancelled", "finished"] as const)("writes null for a parent in %s", async (state) => {
      const fixture = await useStartFixture({ issues });
      const parent = await startParent(fixture, state);

      const result = await runCommand(start, "start", KEY, "--base", parent.base);

      expect(result.code).toBe(0);
      expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ base: parent.base, parentTaskId: null });
    });

    it.each(["landed", "finishing", "cleanup_failed"] as const)("writes the id for a parent in %s", async (state) => {
      const fixture = await useStartFixture({ issues });
      const parent = await startParent(fixture, state);

      const result = await runCommand(start, "start", KEY, "--base", parent.base);

      expect(result.code).toBe(0);
      expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ base: parent.base, parentTaskId: parent.id });
    });

    it("skips a finished task with the same branch that has a higher id", async () => {
      const fixture = await useStartFixture({ issues });
      const parent = await startParent(fixture, "awaiting_work_review");
      seedTasks(fixture.dataRoot, [
        { issueKey: `${PROJECT}#4`, repoKey: PROJECT, state: "finished", at: dayAt(1), branch: parent.branch },
      ]);

      const result = await runCommand(start, "start", KEY, "--base", parent.base);

      expect(result.code).toBe(0);
      expect(latestTaskOf(fixture.dataRoot, KEY).parentTaskId).toBe(parent.id);
    });

    it("takes an active task with the same branch that has a higher id", async () => {
      const fixture = await useStartFixture({ issues });
      const parent = await startParent(fixture, "awaiting_work_review");
      const [newer] = seedTasks(fixture.dataRoot, [
        {
          issueKey: `${PROJECT}#4`,
          repoKey: PROJECT,
          state: "awaiting_work_review",
          at: dayAt(1),
          branch: parent.branch,
        },
      ]);

      const result = await runCommand(start, "start", KEY, "--base", parent.base);

      expect(result.code).toBe(0);
      expect(latestTaskOf(fixture.dataRoot, KEY).parentTaskId).toBe(newer.id);
    });

    it("ignores an active task of another repo with the same branch", async () => {
      const fixture = await useStartFixture({ issues });
      const parent = await startParent(fixture, "cancelled");
      seedTasks(fixture.dataRoot, [
        {
          issueKey: "other/repo#1",
          repoKey: "other/repo",
          state: "awaiting_work_review",
          at: dayAt(1),
          branch: parent.branch,
        },
      ]);

      const result = await runCommand(start, "start", KEY, "--base", parent.base);

      expect(result.code).toBe(0);
      expect(latestTaskOf(fixture.dataRoot, KEY).parentTaskId).toBeNull();
    });
  });

  it("refuses more than one ready blocker and makes no task", async () => {
    const fixture = await useStartFixture({
      issues,
      ghAnswers: [blockersOf({ number: 3, state: "OPEN" }, { number: 4, state: "OPEN" })],
    });
    seedReady(fixture.dataRoot, [3, 4]);

    const result = await runCommand(start, "start", KEY);

    expect(result).toEqual({
      code: 1,
      out: "",
      err:
        "codeguru42/tasker#5 has more than one blocker ready to stack: codeguru42/tasker#3, codeguru42/tasker#4; " +
        "pass --base refs/heads/<branch> to pick one\n",
    });
    expect(hasTask(fixture.dataRoot)).toBe(false);
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("refuses an open blocker with no task and makes no task", async () => {
    const fixture = await useStartFixture({ issues, ghAnswers: [blockersOf({ number: 3, state: "OPEN" })] });

    const result = await runCommand(start, "start", KEY);

    expect(result).toEqual({ code: 1, out: "", err: stillOpen(BLOCKER) });
    expect(hasTask(fixture.dataRoot)).toBe(false);
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("counts a blocker whose task landed as done", async () => {
    const fixture = await useStartFixture({ issues, ghAnswers: [blockersOf({ number: 3, state: "OPEN" })] });
    seedTasks(fixture.dataRoot, [
      { issueKey: BLOCKER, repoKey: PROJECT, state: "landed", at: dayAt(1), branch: "task-3" },
    ]);

    const result = await runCommand(start, "start", KEY);

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: main\n");
  });

  it("lets a base: label win and reads no blockers", async () => {
    const fixture = await useStartFixture({
      issues: [{ project: PROJECT, number: 5, labels: ["base: dev"] }],
      ghAnswers: [blockersOf({ number: 3, state: "OPEN" })],
    });
    await fixture.origin.createBranch("dev");
    seedReady(fixture.dataRoot, [3]);

    const result = await runCommand(start, "start", KEY);

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: dev\n");
    expect(blockerReadCalls(fixture.gh)).toEqual([]);
  });

  it("lets --base win and reads no blockers", async () => {
    const fixture = await useStartFixture({ issues, ghAnswers: [blockersOf({ number: 3, state: "OPEN" })] });
    seedReady(fixture.dataRoot, [3]);

    const result = await runCommand(start, "start", KEY, "--base", "main");

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: main\n");
    expect(blockerReadCalls(fixture.gh)).toEqual([]);
  });

  it("fails when the read of the blockers fails, and makes no task", async () => {
    const fixture = await useStartFixture({
      ghAnswers: [
        {
          args: blockersGraphqlArgs("codeguru42", "tasker", "5"),
          stderr: "blockers read broke",
          exitCode: 1,
        },
      ],
    });

    const result = await runCommand(start, "start", KEY);

    expect(result.code).toBe(1);
    expect(result.err).toContain("blockers read broke");
    expect(hasTask(fixture.dataRoot)).toBe(false);
  });

  describe("on a second run with no stored base", () => {
    it("refuses and leaves a task in provisioning as it was", async () => {
      const fixture = await useStartFixture({ issues, ghAnswers: [blockersOf({ number: 3, state: "OPEN" })] });
      seedTasks(fixture.dataRoot, [
        { issueKey: KEY, repoKey: PROJECT, state: "provisioning", at: dayAt(1), title: "Issue 5" },
      ]);

      await expectCommandRefused(
        { dataRoot: fixture.dataRoot, key: KEY },
        () => runCommand(start, "start", KEY),
        stillOpen(BLOCKER),
      );
    });

    it("refuses and leaves a failed task as it was", async () => {
      const fixture = await useStartFixture({ issues, ghAnswers: [blockersOf({ number: 3, state: "OPEN" })] });
      seedTasks(fixture.dataRoot, [
        {
          issueKey: KEY,
          repoKey: PROJECT,
          state: "provisioning",
          at: dayAt(1),
          title: "Issue 5",
          failWith: "boom",
        },
      ]);

      await expectCommandRefused(
        { dataRoot: fixture.dataRoot, key: KEY },
        () => runCommand(start, "start", KEY),
        stillOpen(BLOCKER),
      );
      expect(taskState(fixture.dataRoot)).toBe("failed");
    });
  });
});
