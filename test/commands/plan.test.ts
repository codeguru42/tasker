import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { plan } from "../../src/commands/plan.js";
import { archivePrompt } from "../../src/prompts/archive.js";
import { PLAN_PROMPT, PLAN_PROMPT_NAME } from "../../src/prompts/plan.js";
import { transitionTask } from "../../src/state/machine.js";
import { createDataRoot, planRevisionPath, planTranscriptPath, taskPlansDir } from "../../src/store/layout.js";
import { type Task } from "../../src/store/store.js";
import { taskLockName } from "../../src/store/locks.js";
import {
  claudeSample,
  dayAt,
  eventsOf,
  fakeGh,
  ghTokenAnswer,
  lockNames,
  planAnswerStream,
  readRunMarker,
  runCommand,
  seedPlanRevision,
  seedPlanSession,
  seedTaskWithPlanFiles,
  startTaskWithCommits,
  startLockHolder,
  TEST_SESSION_ID,
  usePlanFixture,
  validPlanAnswer,
  withDataRootStore,
  withRawDatabase,
} from "../helpers.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

const runPlan = (key = KEY, ...extra: string[]) => runCommand(plan, "plan", key, ...extra);

type Fixture = Awaited<ReturnType<typeof usePlanFixture>>;

const taskOf = (fixture: Fixture) =>
  withDataRootStore(fixture.started.dataRoot, (store) => store.findLatestTask(REPO, KEY)!);

// Revision 1 of the task, or undefined.
const revisionOf = (fixture: Fixture, task: Task) =>
  withDataRootStore(fixture.started.dataRoot, (store) => store.getPlanRevision(task.id, 1));

// The lines of a transcript file, with no empty last item.
const transcriptLines = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");

const dbPathOf = (fixture: Fixture) => createDataRoot(fixture.started.dataRoot).database;

// The events after the events of the start, as { type, data }.
const eventsAfterStart = (fixture: Fixture) => {
  const events = eventsOf(fixture.started.dataRoot, KEY);
  const first = events.findIndex(
    (event) => event.type === "transition" && (event.data as { to?: string }).to === "planning",
  );
  return first === -1 ? [] : events.slice(first);
};

// What a failure before the run must leave: no plan session, no claude call and no lock.
const expectNoRun = (fixture: Fixture) => {
  const task = taskOf(fixture);
  withDataRootStore(fixture.started.dataRoot, (store) => expect(store.planSession(task.id)).toBeUndefined());
  expect(fixture.claude.calls()).toEqual([]);
  expect(lockNames(fixture.started.dataRoot)).toEqual([]);
};

describe("plan", () => {
  it("records revision v1 and moves the task to awaiting_plan_review", async () => {
    const answer = validPlanAnswer();
    const fixture = await usePlanFixture({ stream: planAnswerStream(answer) });

    const result = await runPlan();

    const task = taskOf(fixture);
    const revision = revisionOf(fixture, task);
    const promptPath = archivePrompt(fixture.started.dataRoot, PLAN_PROMPT_NAME, PLAN_PROMPT).path;
    const planPath = planRevisionPath(fixture.started.dataRoot, task, 1);
    expect(result).toEqual({
      code: 0,
      out: [
        `planned ${KEY} as revision v1`,
        `plan: ${planPath}`,
        `prompt: ${promptPath}`,
        "todos:",
        "- write-test: Add the a module",
        "- make-it-pass: Add the a module",
        "questions: 1",
        "",
      ].join("\n"),
      err: "",
    });
    expect(task.state).toBe("awaiting_plan_review");
    expect(readRunMarker(dbPathOf(fixture), task.id)).toBeUndefined();
    expect(revision).toMatchObject({ version: 1, source: "plan", feedback: null, answer });
    expect(revision?.prompt).toMatch(/^plan@[0-9a-f]{12}$/);
    expect(promptPath).toContain(revision!.prompt);
    expect(existsSync(promptPath)).toBe(true);
    expect(readFileSync(planPath, "utf8")).toBe(answer.plan_markdown);
    expect(eventsAfterStart(fixture)).toEqual([
      { type: "transition", data: { from: "workspace_ready", to: "planning" } },
      { type: "usage", data: expect.anything() },
      { type: "plan_revision", data: { version: 1, prompt: revision!.prompt } },
      { type: "transition", data: { from: "planning", to: "awaiting_plan_review" } },
    ]);
  });

  it("gives the issue text on the stdin of the assistant", async () => {
    const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer()) });

    await runPlan();

    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.stdin).toContain(`Key: ${KEY}\nTitle: Issue 5`);
  });

  it("records the session before the spawn, with the provider, model and effort of the plan role", async () => {
    const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer()) });

    await runPlan();

    const task = taskOf(fixture);
    const session = withDataRootStore(fixture.started.dataRoot, (store) => store.planSession(task.id));
    const argv = fixture.claude.calls()[0]!.argv;
    expect(argv[argv.indexOf("--session-id") + 1]).toBe(session?.sessionId);
    expect(session).toMatchObject({ provider: "claude-code", model: "opus", effort: "high" });
  });

  it("continues a recorded plan session and records no second one", async () => {
    const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer()) });
    withDataRootStore(fixture.started.dataRoot, (store) => seedPlanSession(store, taskOf(fixture).id));

    const result = await runPlan();

    expect(result.code).toBe(0);
    const argv = fixture.claude.calls()[0]!.argv;
    expect(argv[argv.indexOf("--resume") + 1]).toBe(TEST_SESSION_ID);
    expect(argv).not.toContain("--session-id");
    const rows = withDataRootStore(fixture.started.dataRoot, (store) => store.planSession(taskOf(fixture).id));
    expect(rows?.sessionId).toBe(TEST_SESSION_ID);
  });

  it("writes one JSON line of the transcript for each line of the stream", async () => {
    const stream = planAnswerStream(validPlanAnswer());
    const fixture = await usePlanFixture({ stream });

    await runPlan();

    const path = planTranscriptPath(fixture.started.dataRoot, taskOf(fixture), 1);
    const lines = transcriptLines(path);
    expect(lines).toHaveLength(stream.length);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("fails the task when the assistant fails, and a second run keeps the transcript", async () => {
    const stream = planAnswerStream(validPlanAnswer());
    const fixture = await usePlanFixture({ stream, exitCode: 1, stderr: "boom" });

    const first = await runPlan();

    const task = taskOf(fixture);
    expect(first.code).toBe(1);
    expect(first.err).toMatch(/^planning failed: .+\n$/);
    expect(task.state).toBe("failed");
    expect(revisionOf(fixture, task)).toBeUndefined();
    expect(eventsAfterStart(fixture).at(-1)).toEqual({
      type: "transition",
      data: { from: "planning", to: "failed", error: first.err.trimEnd() },
    });
    const path = planTranscriptPath(fixture.started.dataRoot, task, 1);
    const firstLines = transcriptLines(path);
    expect(firstLines.length).toBeGreaterThan(0);

    withDataRootStore(fixture.started.dataRoot, (store) => transitionTask(store, task.id, "workspace_ready"));
    const second = await runPlan();

    expect(second.code).toBe(1);
    const secondLines = transcriptLines(path);
    expect(secondLines).toEqual([...firstLines, ...firstLines]);
  });

  it("blocks the task on a quota stop", async () => {
    const fixture = await usePlanFixture({ stream: claudeSample("quota-stop"), exitCode: 1 });

    const result = await runPlan();

    expect(result.code).toBe(1);
    expect(result.out).toMatch(/^planning stopped by a quota limit; /);
    expect(taskOf(fixture).state).toBe("quota_blocked");
    expect(readRunMarker(dbPathOf(fixture), taskOf(fixture).id)).toBeUndefined();
  });

  it("fails the task for an answer that tasker refuses, and writes no row", async () => {
    const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer({ todos: [] })) });

    const result = await runPlan();

    const message =
      "the assistant returned a plan that tasker refuses:\n  - todos: a plan with no todos is not a plan";
    const task = taskOf(fixture);
    expect(result).toEqual({ code: 1, out: "", err: `${message}\n` });
    expect(task.state).toBe("failed");
    expect(eventsAfterStart(fixture).at(-1)).toEqual({
      type: "transition",
      data: { from: "planning", to: "failed", error: message },
    });
    expect(revisionOf(fixture, task)).toBeUndefined();
  });

  it("fails the task with no planning failed prefix when the plan file cannot be written", async () => {
    const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer()) });
    const task = taskOf(fixture);
    const plansDir = taskPlansDir(fixture.started.dataRoot, task);
    mkdirSync(dirname(plansDir), { recursive: true });
    writeFileSync(plansDir, "a file, not a folder");

    const result = await runPlan();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^cannot write the plan file of revision v1: .+\n$/);
    expect(result.err).not.toContain("planning failed:");
    expect(taskOf(fixture).state).toBe("failed");
    expect(revisionOf(fixture, task)).toBeUndefined();
  });

  it("fails the task with planning failed when the last transaction throws after the plan file is written", async () => {
    const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer()) });
    const task = taskOf(fixture);
    withRawDatabase(dbPathOf(fixture), (db) =>
      db.exec(
        "CREATE TRIGGER refuse_plan_revision BEFORE INSERT ON plan_revisions BEGIN SELECT RAISE(ABORT, 'refused by the test'); END",
      ),
    );

    const result = await runPlan();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^planning failed: .*refused by the test.*\n$/);
    expect(taskOf(fixture).state).toBe("failed");
    expect(revisionOf(fixture, task)).toBeUndefined();
    expect(existsSync(planRevisionPath(fixture.started.dataRoot, task, 1))).toBe(true);
    expect(eventsAfterStart(fixture).at(-1)).toEqual({
      type: "transition",
      data: { from: "planning", to: "failed", error: result.err.trimEnd() },
    });
  });

  it("replaces a stale v1.md with the plan", async () => {
    const answer = validPlanAnswer();
    const fixture = await usePlanFixture({ stream: planAnswerStream(answer) });
    const path = planRevisionPath(fixture.started.dataRoot, taskOf(fixture), 1);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "left by a stopped run");

    const result = await runPlan();

    expect(result.code).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(answer.plan_markdown);
  });

  it("fails the task with planning failed when an error occurs after the move to planning", async () => {
    const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer()) });
    const path = planTranscriptPath(fixture.started.dataRoot, taskOf(fixture), 1);
    mkdirSync(path, { recursive: true });

    const result = await runPlan();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^planning failed: .+\n$/);
    const task = taskOf(fixture);
    expect(task.state).toBe("failed");
    expect(eventsAfterStart(fixture).at(-1)).toEqual({
      type: "transition",
      data: { from: "planning", to: "failed", error: result.err.trimEnd() },
    });
    expect(readRunMarker(dbPathOf(fixture), task.id)).toBeUndefined();
  });

  describe("a failure before the run", () => {
    it("fails for an issue with no task", async () => {
      const fixture = await usePlanFixture({});

      const result = await runPlan("codeguru42/tasker#6");

      expect(result.code).toBe(1);
      expect(result.err).toBe(`no task for the issue codeguru42/tasker#6 in the repo ${REPO}\n`);
      expect(taskOf(fixture).state).toBe("workspace_ready");
      expectNoRun(fixture);
    });

    it("fails at once when another process holds the task lock", async () => {
      const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer()) });
      const name = taskLockName(REPO, KEY);
      const holder = startLockHolder(dbPathOf(fixture), name);
      await holder.attempt;

      const result = await runPlan();

      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toMatch(new RegExp(`^the lock ${name} is busy: process ${holder.pid} took it at .+\\n$`));
      expect(taskOf(fixture).state).toBe("workspace_ready");
      expect(withDataRootStore(fixture.started.dataRoot, (store) => store.planSession(taskOf(fixture).id))).toBeUndefined();
      expect(fixture.claude.calls()).toEqual([]);
      expect(lockNames(fixture.started.dataRoot)).toEqual([name]);
    });

    it("fails when the issue cannot be read", async () => {
      const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer()) });
      fakeGh(dirname(fixture.started.configPath), {}, [
        ghTokenAnswer("codeguru42", "gho_test"),
        {
          args: ["issue", "view", "5", "-R", REPO, "--json", "number,title,body,url,labels,state"],
          stderr: "no such issue",
          exitCode: 1,
        },
      ]);

      const result = await runPlan();

      expect(result.code).toBe(1);
      expect(result.err).not.toBe("");
      expect(taskOf(fixture).state).toBe("workspace_ready");
      expectNoRun(fixture);
    });

    it("fails for a task that is not in workspace_ready, and reads no issue", async () => {
      const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer()) });
      withDataRootStore(fixture.started.dataRoot, (store) =>
        transitionTask(store, taskOf(fixture).id, "failed", { error: "earlier" }),
      );
      const ghCalls = fixture.started.gh.calls().length;

      const result = await runPlan();

      expect(result).toEqual({
        code: 1,
        out: "",
        err: `the task of ${KEY} is in failed; tasker plan needs workspace_ready\n`,
      });
      expect(taskOf(fixture).state).toBe("failed");
      expect(fixture.started.gh.calls()).toHaveLength(ghCalls);
      expectNoRun(fixture);
    });

    it("fails when the prompt cannot be archived", async () => {
      const fixture = await usePlanFixture({ stream: planAnswerStream(validPlanAnswer()) });
      const prompts = join(fixture.started.dataRoot, "prompts");
      chmodSync(prompts, 0o555);
      onTestFinished(() => chmodSync(prompts, 0o755));

      const result = await runPlan();

      expect(result.code).toBe(1);
      expect(result.err).not.toBe("");
      expect(taskOf(fixture).state).toBe("workspace_ready");
      expectNoRun(fixture);
    });
  });
});

describe("the overlap warning", () => {
  const W1 = "WARNING: this plan changes files that other tasks in flight also change.";
  const W2 = "The task that lands second can get merge conflicts and redo its work.";
  const LAST = "tasker does not refuse. Decide before you approve.";
  const OTHER = { repoKey: REPO, at: dayAt(3) };
  const issues = (...numbers: number[]) => ({
    issues: [5, ...numbers].map((number) => ({ project: REPO, number })),
  });
  const planFixture = (files: string[], ...numbers: number[]) =>
    usePlanFixture({ stream: planAnswerStream(validPlanAnswer({ files_changed: files })) }, issues(...numbers));

  it("warns of a shared file from the plan of a task in flight", async () => {
    const fixture = await planFixture(["src/a.ts", "test/a.test.ts"]);
    seedTaskWithPlanFiles(
      fixture.started.dataRoot,
      { ...OTHER, issueKey: "codeguru42/tasker#7", state: "awaiting_plan_review" },
      ["src/a.ts"],
    );

    const result = await runPlan();

    expect(result.code).toBe(0);
    expect(result.err).toBe(
      [W1, W2, "  codeguru42/tasker#7 (awaiting_plan_review):", "    src/a.ts", LAST, ""].join("\n"),
    );
    expect(taskOf(fixture).state).toBe("awaiting_plan_review");
    const other = withDataRootStore(fixture.started.dataRoot, (store) => store.findLatestTask(REPO, "codeguru42/tasker#7"));
    expect(other?.state).toBe("awaiting_plan_review");
  });

  it("warns of a shared file from the branch of a task in flight", async () => {
    const fixture = await planFixture(["src/a.ts"], 6);
    await startTaskWithCommits(fixture.started, 6, ["src/a.ts"]);

    const result = await runPlan();

    expect(result.code).toBe(0);
    expect(result.err).toBe([W1, W2, "  codeguru42/tasker#6 (workspace_ready):", "    src/a.ts", LAST, ""].join("\n"));
  });

  it("prints no warning when no file is shared", async () => {
    const fixture = await planFixture(["src/a.ts"], 6);
    await startTaskWithCommits(fixture.started, 6, ["src/b.ts"]);
    seedTaskWithPlanFiles(
      fixture.started.dataRoot,
      { ...OTHER, issueKey: "codeguru42/tasker#7", state: "awaiting_plan_review" },
      ["docs/c.md"],
    );

    const result = await runPlan();

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
  });

  it("ignores a task of another repo", async () => {
    const fixture = await planFixture(["src/a.ts"]);
    seedTaskWithPlanFiles(
      fixture.started.dataRoot,
      { issueKey: "codeguru42/other#7", repoKey: "codeguru42/other", state: "awaiting_plan_review", at: dayAt(3) },
      ["src/a.ts"],
    );

    const result = await runPlan();

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
  });

  it("ignores a finished and a cancelled task", async () => {
    const fixture = await planFixture(["src/a.ts"]);
    seedTaskWithPlanFiles(fixture.started.dataRoot, { ...OTHER, issueKey: "codeguru42/tasker#7", state: "finished" }, [
      "src/a.ts",
    ]);
    seedTaskWithPlanFiles(fixture.started.dataRoot, { ...OTHER, issueKey: "codeguru42/tasker#8", state: "cancelled" }, [
      "src/a.ts",
    ]);

    const result = await runPlan();

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
  });

  it("prints a note for a branch that is gone, and still counts the plan files", async () => {
    const fixture = await planFixture(["test/a.test.ts"], 6);
    const task = await startTaskWithCommits(fixture.started, 6, ["src/b.ts"]);
    withDataRootStore(fixture.started.dataRoot, (store) => {
      seedPlanRevision(store, task.id, { answer: validPlanAnswer({ files_changed: ["test/a.test.ts"] }) }, "workspace_ready");
      store.updateTask(task.id, { branch: "issue-6-gone" });
    });

    const result = await runPlan();

    expect(result.code).toBe(0);
    const lines = result.err.split("\n");
    expect(lines[0]).toMatch(
      /^note: cannot read the files of the task branch of codeguru42\/tasker#6: .*cannot resolve the task branch: issue-6-gone/,
    );
    expect(lines.slice(1)).toEqual([W1, W2, "  codeguru42/tasker#6 (workspace_ready):", "    test/a.test.ts", LAST, ""]);
  });

  it("orders the blocks by issue number and the files as text", async () => {
    const fixture = await planFixture(["test/a.test.ts", "src/a.ts"], 6, 10);
    await startTaskWithCommits(fixture.started, 10, ["src/a.ts"]);
    seedTaskWithPlanFiles(
      fixture.started.dataRoot,
      { ...OTHER, issueKey: "codeguru42/tasker#6", state: "awaiting_plan_review" },
      ["test/a.test.ts", "src/a.ts"],
    );

    const result = await runPlan();

    expect(result.code).toBe(0);
    expect(result.err).toBe(
      [
        W1,
        W2,
        "  codeguru42/tasker#6 (awaiting_plan_review):",
        "    src/a.ts",
        "    test/a.test.ts",
        "  codeguru42/tasker#10 (workspace_ready):",
        "    src/a.ts",
        LAST,
        "",
      ].join("\n"),
    );
  });

  it("prints no warning after a failure or a quota stop", async () => {
    for (const control of [
      { stream: planAnswerStream(validPlanAnswer({ files_changed: ["src/a.ts"] })), exitCode: 1, stderr: "boom" },
      { stream: claudeSample("quota-stop"), exitCode: 1 },
    ]) {
      const fixture = await usePlanFixture(control);
      seedTaskWithPlanFiles(
        fixture.started.dataRoot,
        { ...OTHER, issueKey: "codeguru42/tasker#7", state: "awaiting_plan_review" },
        ["src/a.ts"],
      );

      const result = await runPlan();

      expect(result.code).toBe(1);
      expect(result.err).not.toContain("WARNING");
    }
  });
});
