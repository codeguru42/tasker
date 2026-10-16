import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { plan } from "../../src/commands/plan.js";
import { archivePrompt } from "../../src/prompts/archive.js";
import { PLAN_PROMPT, PLAN_PROMPT_NAME } from "../../src/prompts/plan.js";
import { transitionTask } from "../../src/state/machine.js";
import { planRevisionPath, planTranscriptPath, taskPlansDir } from "../../src/store/layout.js";
import { taskLockName } from "../../src/store/locks.js";
import { runCommand } from "../helpers/cli.js";
import { TEST_SESSION_ID, claudeSample } from "../helpers/fake-claude.js";
import { fakeGh, ghTokenAnswer } from "../helpers/fake-gh.js";
import {
  answerStream,
  planRevisionOf,
  seedPlanRevision,
  seedPlanSession,
  seedTaskWithPlanFiles,
  transcriptLines,
  validPlanAnswer,
} from "../helpers/plan.js";
import { overlapWarningText } from "../helpers/overlap.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  dayAt,
  eventsOf,
  latestTaskOf,
  lockNames,
  readRunMarker,
  withDataRootStore,
  withRawDatabase,
} from "../helpers/store.js";
import { expectNoAssistantRun, startTaskWithCommits, usePlanFixture } from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

const runPlan = (key = KEY, ...extra: string[]) => runCommand(plan, "plan", key, ...extra);

type Fixture = Awaited<ReturnType<typeof usePlanFixture>>;

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
  const task = latestTaskOf(fixture.started.dataRoot, KEY);
  withDataRootStore(fixture.started.dataRoot, (store) => expect(store.planSession(task.id)).toBeUndefined());
  expectNoAssistantRun(fixture);
};

describe("plan", () => {
  it("records revision v1 and moves the task to awaiting_plan_review", async () => {
    const answer = validPlanAnswer();
    const fixture = await usePlanFixture({ stream: answerStream(answer) });

    const result = await runPlan();

    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    const revision = planRevisionOf(fixture.started.dataRoot, task.id, 1);
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
    expect(readRunMarker(databasePathOf(fixture.started.dataRoot), task.id)).toBeUndefined();
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
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });

    await runPlan();

    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].stdin).toContain(`Key: ${KEY}\nTitle: Issue 5`);
  });

  it("records the session before the spawn, with the provider, model and effort of the plan role", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });

    await runPlan();

    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    const session = withDataRootStore(fixture.started.dataRoot, (store) => store.planSession(task.id));
    const argv = fixture.claude.calls()[0].argv;
    expect(argv[argv.indexOf("--session-id") + 1]).toBe(session?.sessionId);
    expect(session).toMatchObject({ provider: "claude-code", model: "opus", effort: "high" });
  });

  it("continues a recorded plan session and records no second one", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
    withDataRootStore(fixture.started.dataRoot, (store) =>
      seedPlanSession(store, latestTaskOf(fixture.started.dataRoot, KEY).id),
    );

    const result = await runPlan();

    expect(result.code).toBe(0);
    const argv = fixture.claude.calls()[0].argv;
    expect(argv[argv.indexOf("--resume") + 1]).toBe(TEST_SESSION_ID);
    expect(argv).not.toContain("--session-id");
    const rows = withDataRootStore(fixture.started.dataRoot, (store) =>
      store.planSession(latestTaskOf(fixture.started.dataRoot, KEY).id),
    );
    expect(rows?.sessionId).toBe(TEST_SESSION_ID);
  });

  it("writes one JSON line of the transcript for each line of the stream", async () => {
    const stream = answerStream(validPlanAnswer());
    const fixture = await usePlanFixture({ stream });

    await runPlan();

    const path = planTranscriptPath(fixture.started.dataRoot, latestTaskOf(fixture.started.dataRoot, KEY), 1);
    const lines = transcriptLines(path);
    expect(lines).toHaveLength(stream.length);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("fails the task when the assistant fails, and a second run keeps the transcript", async () => {
    const stream = answerStream(validPlanAnswer());
    const fixture = await usePlanFixture({ stream, exitCode: 1, stderr: "boom" });

    const first = await runPlan();

    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    expect(first.code).toBe(1);
    expect(first.err).toMatch(/^planning failed: .+\n$/);
    expect(task.state).toBe("failed");
    expect(planRevisionOf(fixture.started.dataRoot, task.id, 1)).toBeUndefined();
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
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("quota_blocked");
    expect(
      readRunMarker(databasePathOf(fixture.started.dataRoot), latestTaskOf(fixture.started.dataRoot, KEY).id),
    ).toBeUndefined();
  });

  it("fails the task for an answer that tasker refuses, and writes no row", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer({ todos: [] })) });

    const result = await runPlan();

    const message = "the assistant returned a plan that tasker refuses:\n  - todos: a plan with no todos is not a plan";
    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    expect(result).toEqual({ code: 1, out: "", err: `${message}\n` });
    expect(task.state).toBe("failed");
    expect(eventsAfterStart(fixture).at(-1)).toEqual({
      type: "transition",
      data: { from: "planning", to: "failed", error: message },
    });
    expect(planRevisionOf(fixture.started.dataRoot, task.id, 1)).toBeUndefined();
  });

  it("fails the task with no planning failed prefix when the plan file cannot be written", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    const plansDir = taskPlansDir(fixture.started.dataRoot, task);
    mkdirSync(dirname(plansDir), { recursive: true });
    writeFileSync(plansDir, "a file, not a folder");

    const result = await runPlan();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^cannot write the plan file of revision v1: .+\n$/);
    expect(result.err).not.toContain("planning failed:");
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
    expect(planRevisionOf(fixture.started.dataRoot, task.id, 1)).toBeUndefined();
  });

  it("fails the task with planning failed when the last transaction throws after the plan file is written", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    withRawDatabase(databasePathOf(fixture.started.dataRoot), (db) =>
      db.exec(
        "CREATE TRIGGER refuse_plan_revision BEFORE INSERT ON plan_revisions BEGIN SELECT RAISE(ABORT, 'refused by the test'); END",
      ),
    );

    const result = await runPlan();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^planning failed: .*refused by the test.*\n$/);
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
    expect(planRevisionOf(fixture.started.dataRoot, task.id, 1)).toBeUndefined();
    expect(existsSync(planRevisionPath(fixture.started.dataRoot, task, 1))).toBe(true);
    expect(eventsAfterStart(fixture).at(-1)).toEqual({
      type: "transition",
      data: { from: "planning", to: "failed", error: result.err.trimEnd() },
    });
  });

  it("replaces a stale v1.md with the plan", async () => {
    const answer = validPlanAnswer();
    const fixture = await usePlanFixture({ stream: answerStream(answer) });
    const path = planRevisionPath(fixture.started.dataRoot, latestTaskOf(fixture.started.dataRoot, KEY), 1);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "left by a stopped run");

    const result = await runPlan();

    expect(result.code).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(answer.plan_markdown);
  });

  it("fails the task with planning failed when an error occurs after the move to planning", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
    const path = planTranscriptPath(fixture.started.dataRoot, latestTaskOf(fixture.started.dataRoot, KEY), 1);
    mkdirSync(path, { recursive: true });

    const result = await runPlan();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^planning failed: .+\n$/);
    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    expect(task.state).toBe("failed");
    expect(eventsAfterStart(fixture).at(-1)).toEqual({
      type: "transition",
      data: { from: "planning", to: "failed", error: result.err.trimEnd() },
    });
    expect(readRunMarker(databasePathOf(fixture.started.dataRoot), task.id)).toBeUndefined();
  });

  describe("a failure before the run", () => {
    it("fails for an issue with no task", async () => {
      const fixture = await usePlanFixture({});

      const result = await runPlan("codeguru42/tasker#6");

      expect(result.code).toBe(1);
      expect(result.err).toBe(`no task for the issue codeguru42/tasker#6 in the repo ${REPO}\n`);
      expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("workspace_ready");
      expectNoRun(fixture);
    });

    it("fails at once when another process holds the task lock", async () => {
      const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
      const name = taskLockName(REPO, KEY);
      const holder = startLockHolder(databasePathOf(fixture.started.dataRoot), name);
      await holder.attempt;

      const result = await runPlan();

      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toMatch(new RegExp(`^the lock ${name} is busy: process ${holder.pid} took it at .+\\n$`));
      expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("workspace_ready");
      expect(
        withDataRootStore(fixture.started.dataRoot, (store) =>
          store.planSession(latestTaskOf(fixture.started.dataRoot, KEY).id),
        ),
      ).toBeUndefined();
      expect(fixture.claude.calls()).toEqual([]);
      expect(lockNames(fixture.started.dataRoot)).toEqual([name]);
    });

    it("fails when the issue cannot be read", async () => {
      const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
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
      expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("workspace_ready");
      expectNoRun(fixture);
    });

    it("fails for a task that is not in workspace_ready, and reads no issue", async () => {
      const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
      withDataRootStore(fixture.started.dataRoot, (store) =>
        transitionTask(store, latestTaskOf(fixture.started.dataRoot, KEY).id, "failed", { error: "earlier" }),
      );
      const ghCalls = fixture.started.gh.calls().length;

      const result = await runPlan();

      expect(result).toEqual({
        code: 1,
        out: "",
        err: `the task of ${KEY} is in failed; tasker plan needs workspace_ready\n`,
      });
      expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
      expect(fixture.started.gh.calls()).toHaveLength(ghCalls);
      expectNoRun(fixture);
    });

    it("fails when the prompt cannot be archived", async () => {
      const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
      const prompts = join(fixture.started.dataRoot, "prompts");
      chmodSync(prompts, 0o555);
      onTestFinished(() => chmodSync(prompts, 0o755));

      const result = await runPlan();

      expect(result.code).toBe(1);
      expect(result.err).not.toBe("");
      expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("workspace_ready");
      expectNoRun(fixture);
    });
  });
});

describe("the overlap warning", () => {
  const LAST = ["tasker does not refuse. Decide before you approve."];
  const OTHER = { repoKey: REPO, at: dayAt(3) };
  const issues = (...numbers: number[]) => ({
    issues: [5, ...numbers].map((number) => ({ project: REPO, number })),
  });
  const planFixture = (files: string[], ...numbers: number[]) =>
    usePlanFixture({ stream: answerStream(validPlanAnswer({ files_changed: files })) }, issues(...numbers));

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
      overlapWarningText(
        [{ issueKey: "codeguru42/tasker#7", state: "awaiting_plan_review", files: ["src/a.ts"] }],
        LAST,
      ),
    );
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("awaiting_plan_review");
    const other = withDataRootStore(fixture.started.dataRoot, (store) =>
      store.findLatestTask(REPO, "codeguru42/tasker#7"),
    );
    expect(other?.state).toBe("awaiting_plan_review");
  });

  it("warns of a shared file from the branch of a task in flight", async () => {
    const fixture = await planFixture(["src/a.ts"], 6);
    await startTaskWithCommits(fixture.started, 6, ["src/a.ts"]);

    const result = await runPlan();

    expect(result.code).toBe(0);
    expect(result.err).toBe(
      overlapWarningText([{ issueKey: "codeguru42/tasker#6", state: "workspace_ready", files: ["src/a.ts"] }], LAST),
    );
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
      seedPlanRevision(
        store,
        task.id,
        { answer: validPlanAnswer({ files_changed: ["test/a.test.ts"] }) },
        "workspace_ready",
      );
      store.updateTask(task.id, { branch: "issue-6-gone" });
    });

    const result = await runPlan();

    expect(result.code).toBe(0);
    const lines = result.err.split("\n");
    expect(lines[0]).toMatch(
      /^note: cannot read the files of the task branch of codeguru42\/tasker#6: .*cannot resolve the task branch: issue-6-gone/,
    );
    expect(lines.slice(1).join("\n")).toBe(
      overlapWarningText(
        [{ issueKey: "codeguru42/tasker#6", state: "workspace_ready", files: ["test/a.test.ts"] }],
        LAST,
      ),
    );
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
      overlapWarningText(
        [
          { issueKey: "codeguru42/tasker#6", state: "awaiting_plan_review", files: ["src/a.ts", "test/a.test.ts"] },
          { issueKey: "codeguru42/tasker#10", state: "workspace_ready", files: ["src/a.ts"] },
        ],
        LAST,
      ),
    );
  });

  it("prints no warning after a failure or a quota stop", async () => {
    for (const control of [
      { stream: answerStream(validPlanAnswer({ files_changed: ["src/a.ts"] })), exitCode: 1, stderr: "boom" },
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
