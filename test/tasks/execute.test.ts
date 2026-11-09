import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkTurnResult } from "../../src/plan/turn-result.js";
import type { Config } from "../../src/config/schema.js";
import { promptVersion } from "../../src/prompts/archive.js";
import { captureAssistantStartInputs } from "../helpers/assistant-run.js";
import {
  currentTodoText,
  EXECUTE_FIX_PROMPT,
  EXECUTE_FIX_PROMPT_NAME,
  EXECUTE_PROMPT,
  EXECUTE_PROMPT_NAME,
  EXECUTE_TODO_PROMPT,
  EXECUTE_TODO_PROMPT_NAME,
  NO_VERIFY_LOG,
  resolvedQuestionsText,
  todosText,
} from "../../src/prompts/execute.js";
import { fillTemplate } from "../../src/prompts/template.js";
import { transitionTask } from "../../src/state/machine.js";
import { executeTranscriptPath, planRevisionPath, taskTranscriptsDir } from "../../src/store/layout.js";
import { resumeTask } from "../../src/tasks/resume.js";
import { requireBaseRevision } from "../../src/tasks/task-state.js";
import { EXECUTE_COMMIT_TEXT } from "../../src/vcs/git/assistant-surface.js";
import { executeTask, type ExecuteRequest } from "../../src/tasks/execute.js";
import { retryTask } from "../../src/tasks/retry.js";
import { captureIo } from "../helpers/cli.js";
import { withTrustedExtensions } from "../helpers/config.js";
import {
  moveOrigin,
  pushBranch,
  pushMessageExpected,
  pushScript,
  shell,
  signalTasker,
} from "../helpers/remote-push.js";
import { commitIndexChanges, gitOutput, gitProvider } from "../helpers/git.js";
import {
  argAfter,
  claudeApprovalWarningEvent,
  claudeOverageEvent,
  claudeSample,
  claudeSampleWithResult,
  TEST_EXECUTE_SESSION_ID,
  withEventBeforeResult,
  withEventFirst,
} from "../helpers/fake-claude.js";
import {
  planTodo,
  seedExecuteFixTurn,
  seedExecuteSession,
  seedExecuteTodoStates,
  transcriptLines,
  turnResultStream,
} from "../helpers/plan.js";
import { quotaPauseLineExpected } from "../helpers/quota.js";
import { writeFileWithParents } from "../helpers/temp.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  seedCreditsApproval,
  seedCreditsApprovalIn,
  withDataRootStore,
  withRawDatabase,
} from "../helpers/store.js";
import {
  appendBaseEvent,
  type ExecuteFixture,
  expectRefusedWithoutChange,
  taskRefOf,
  useExecuteFixture,
} from "../helpers/task-fixtures.js";

// Runs executeTask for the task of the fixture. change replaces fields of the request.
async function runExecute(fixture: ExecuteFixture, change: Partial<ExecuteRequest> = {}) {
  const io = captureIo();
  const { started, task, config, env } = fixture;
  const ref = taskRefOf(started);
  const result = await withDataRootStore(config.dataRoot, (store) =>
    executeTask(store, { config, ref, taskId: task.id, env, io, ...change }),
  );
  return { result, io };
}

const sessionRows = (dataRoot: string): number =>
  withRawDatabase(databasePathOf(dataRoot), (db) => {
    const row = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE role = 'execute'").get() as { n: number };
    return row.n;
  });

const executePromptFiles = (dataRoot: string): string[] =>
  existsSync(join(dataRoot, "prompts"))
    ? readdirSync(join(dataRoot, "prompts")).filter((name) => name.startsWith("execute"))
    : [];

// Runs executeTask, expects it to throw a message that starts with message, and expects that the run wrote nothing:
// the state and the events as before (see expectRefusedWithoutChange), no new session row, no transcript, no claude call and no archived prompt.
async function expectRefused(
  fixture: ExecuteFixture,
  message: string,
  change: Partial<ExecuteRequest> = {},
): Promise<void> {
  const { dataRoot } = fixture.started;
  const sessions = sessionRows(dataRoot);

  await expectRefusedWithoutChange(fixture.started, () => runExecute(fixture, change), message);

  expect(sessionRows(dataRoot)).toBe(sessions);
  expect(existsSync(executeTranscriptPath(dataRoot, fixture.task, 1))).toBe(false);
  expect(fixture.claude.calls()).toEqual([]);
  expect(executePromptFiles(dataRoot)).toEqual([]);
}

describe("executeTask checks", () => {
  it("refuses a task that is not in approved", async () => {
    const fixture = await useExecuteFixture({});
    withDataRootStore(fixture.config.dataRoot, (store) =>
      transitionTask(store, fixture.task.id, "awaiting_plan_review"),
    );

    await expectRefused(
      fixture,
      "the task of codeguru42/tasker#5 is in awaiting_plan_review; tasker execute needs approved",
    );
  });

  it("refuses a task that has no pinned revision", async () => {
    const fixture = await useExecuteFixture({});
    withRawDatabase(databasePathOf(fixture.config.dataRoot), (db) => {
      db.prepare("UPDATE plan_revisions SET approved_at = NULL").run();
    });

    await expectRefused(fixture, "the task of codeguru42/tasker#5 is approved, but no revision is pinned");
  });

  it("refuses a task whose plan file is missing and names the path", async () => {
    const fixture = await useExecuteFixture({});
    const path = planRevisionPath(fixture.config.dataRoot, fixture.task, 1);
    rmSync(path);

    await expectRefused(fixture, `cannot read the plan file ${path} of revision v1: `);
  });

  it("refuses todos with a dependency cycle", async () => {
    const todos = [planTodo("a", ["b"]), planTodo("b", ["a"])];
    const fixture = await useExecuteFixture({}, { answer: { todos } });

    await expectRefused(fixture, "todos: a dependency cycle between a, b");
  });

  it("refuses a task that has no base", async () => {
    const fixture = await useExecuteFixture({});
    withDataRootStore(fixture.config.dataRoot, (store) => store.updateTask(fixture.task.id, { base: null }));

    await expectRefused(fixture, "the task of codeguru42/tasker#5 has no base revision");
  });

  it("refuses a run when the remote cannot be read before the run", async () => {
    const fixture = await useExecuteFixture({});
    const repo = fixture.config.repos[fixture.started.repoKey];
    const config: Config = {
      ...fixture.config,
      repos: {
        ...fixture.config.repos,
        [fixture.started.repoKey]: { ...repo, remote: join(fixture.config.dataRoot, "missing-remote") },
      },
    };

    await expectRefused({ ...fixture, config }, "cannot read the remote before the run: ", { config });
  });

  it("refuses a recorded execute session whose model the provider refuses", async () => {
    const fixture = await useExecuteFixture({});
    withDataRootStore(fixture.config.dataRoot, (store) =>
      seedExecuteSession(store, fixture.task.id, 1, { model: "gpt-5" }),
    );

    await expectRefused(
      fixture,
      "the execute session of codeguru42/tasker#5 runs on gpt-5, and claude-code refuses it: ",
    );
  });
});

// The todos in the plan order b, a, so that the dependency order a, b shows in the tests.
const TODOS = [planTodo("b", ["a"]), planTodo("a")];

const todoPrompt = (id: string): string =>
  fillTemplate(EXECUTE_TODO_PROMPT_NAME, EXECUTE_TODO_PROMPT, {
    CURRENT_TODO: currentTodoText(TODOS.find((todo) => todo.id === id)!),
  });

// The prefix of the first turn of a new session, as the plan gives it, with doneIds marked done in the todos.
const expectedPrefix = (fixture: ExecuteFixture, todos: typeof TODOS, doneIds: ReadonlySet<string>): string => {
  const { dataRoot } = fixture.started;
  const baseRevision = requireBaseRevision(gitProvider(), latestTaskOf(dataRoot, fixture.started.key));
  const questions = withDataRootStore(dataRoot, (store) => store.resolvedQuestionsThrough(fixture.task.id, 1));
  return fillTemplate(EXECUTE_PROMPT_NAME, EXECUTE_PROMPT, {
    COMMIT_RULES: fillTemplate("commit-rules", EXECUTE_COMMIT_TEXT, { BASE_REF: baseRevision }),
    PLAN_MARKDOWN: fixture.revision.answer.plan_markdown,
    TODOS: todosText(todos, doneIds),
    RESOLVED_QUESTIONS: resolvedQuestionsText(questions),
  });
};

const fixPrompt = (): string =>
  fillTemplate(EXECUTE_FIX_PROMPT_NAME, EXECUTE_FIX_PROMPT, {
    VERIFY_FAILURE: "npm test failed",
    VERIFY_LOG: NO_VERIFY_LOG,
  });

// The states in the plan order.
const todoStates = (fixture: ExecuteFixture): [string, string][] =>
  withDataRootStore(fixture.config.dataRoot, (store) =>
    store.executeTodoProgress(fixture.task.id, 1).map((entry) => [entry.todo.id, entry.state]),
  );

const eventTypes = (fixture: ExecuteFixture, types: string[]) =>
  eventsOf(fixture.config.dataRoot, fixture.started.key).filter((event) => types.includes(event.type));

const doneStream = turnResultStream("done");

const protectedSkillPath = ".agents/skills/request.md";
const protectedSkillContent = "requested skill\n";
const protectedRequestScript = [
  "export GIT_AUTHOR_NAME='Tasker Test' GIT_COMMITTER_NAME='Tasker Test' GIT_AUTHOR_EMAIL='tasker-test@example.com' GIT_COMMITTER_EMAIL='tasker-test@example.com'",
  `oid=$(printf 'requested skill\\n' | git hash-object -w --stdin)`,
  `git update-index --add --cacheinfo 100644,$oid,${protectedSkillPath}`,
  "tree=$(git write-tree)",
  "parent=$(git rev-parse HEAD)",
  `commit=$(printf 'protected skill request\\n' | git commit-tree "$tree" -p "$parent")`,
  "branch=$(git branch --show-current)",
  'git update-ref "refs/heads/$branch" "$commit" "$parent"',
].join(" && ");

const protectedTurnOf = (fixture: ExecuteFixture, turnId = "todo:a") =>
  withDataRootStore(fixture.config.dataRoot, (store) => store.protectedExecuteTurn(fixture.task.id, 1, turnId));

const branchHeadOf = (fixture: ExecuteFixture) =>
  gitOutput({ gitDir: fixture.started.clone }, fixture.env, "rev-parse", `refs/heads/${fixture.started.branch}`);

const indexTreeOf = (fixture: ExecuteFixture) =>
  gitOutput({ cwd: fixture.started.worktree }, fixture.env, "write-tree");

const headTreeOf = (fixture: ExecuteFixture) =>
  gitOutput({ cwd: fixture.started.worktree }, fixture.env, "rev-parse", "HEAD^{tree}");

describe("executeTask turns", () => {
  it("passes the turn-result check to every execute turn", async () => {
    const inputs = captureAssistantStartInputs("prepareTaskExecuteRun");
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });

    await runExecute(fixture);

    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => typeof input.checkAnswer)).toEqual(["function", "function"]);
    expect(inputs.map((input) => input.checkAnswer)).toEqual([checkTurnResult, checkTurnResult]);
  });

  it("puts the local base of the task in the commit rules of the first turn", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });
    appendBaseEvent({ dataRoot: fixture.started.dataRoot, task: fixture.task }, "refs/heads/x", "refs/heads/x");

    await runExecute(fixture);

    expect(fixture.claude.calls()[0].stdin).toContain("git log --reverse refs/heads/x..HEAD");
  });

  it("runs a new session in the dependency order with the prefix on the first turn only", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });
    const { dataRoot } = fixture.started;
    const prefix = expectedPrefix(fixture, TODOS, new Set());

    const { result } = await runExecute(fixture);

    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(2);
    expect(calls[0].stdin).toBe(`${prefix}\n${todoPrompt("a")}`);
    expect(calls[1].stdin).toBe(todoPrompt("b"));
    const id = argAfter(calls[0].argv, "--session-id");
    expect(id).toBeDefined();
    expect(calls[0].argv).not.toContain("--resume");
    expect(argAfter(calls[1].argv, "--resume")).toBe(id);
    expect(withDataRootStore(dataRoot, (store) => store.executeSession(fixture.task.id, 1)?.sessionId)).toBe(id);
    expect(result).toMatchObject({ version: 1, todosDone: 2, todosTotal: 2, fixTurnDone: false, denials: 0 });
  });

  it("records the trusted extension list for a new execute session", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });
    const repoKey = fixture.started.repoKey;
    const trustedExtensions = ["configured-execute-key"];
    fixture.config = withTrustedExtensions(fixture.config, repoKey, trustedExtensions);
    await runExecute(fixture);
    expect(
      withDataRootStore(fixture.started.dataRoot, (store) => store.executeSession(fixture.task.id, 1)),
    ).toMatchObject({
      trustedExtensions,
    });
  });

  it("continues a recorded session and skips a done todo", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });
    withDataRootStore(fixture.config.dataRoot, (store) => {
      seedExecuteSession(store, fixture.task.id, 1);
      seedExecuteTodoStates(store, fixture.task.id, 1, { a: "done" });
    });

    await runExecute(fixture);

    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--resume")).toBe(TEST_EXECUTE_SESSION_ID);
    expect(calls[0].stdin).toBe(todoPrompt("b"));
    expect(eventTypes(fixture, ["executed"])[0].data).toMatchObject({
      prompts: [promptVersion(EXECUTE_TODO_PROMPT_NAME, EXECUTE_TODO_PROMPT)],
    });
  });

  it("marks each todo done, writes the todo events and moves the task to executed", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });
    const { dataRoot, key } = fixture.started;

    const { result } = await runExecute(fixture);

    expect(result).toMatchObject({ todosDone: 2, todosTotal: 2 });
    expect(todoStates(fixture)).toEqual([
      ["b", "done"],
      ["a", "done"],
    ]);
    expect(eventTypes(fixture, ["todo_started", "todo_done", "executed"])).toEqual([
      { type: "todo_started", data: { id: "a" } },
      { type: "todo_done", data: { id: "a" } },
      { type: "todo_started", data: { id: "b" } },
      { type: "todo_done", data: { id: "b" } },
      {
        type: "executed",
        data: {
          version: 1,
          prompts: [
            promptVersion(EXECUTE_PROMPT_NAME, EXECUTE_PROMPT),
            promptVersion(EXECUTE_TODO_PROMPT_NAME, EXECUTE_TODO_PROMPT),
          ],
          from: "executing",
          to: "executed",
        },
      },
    ]);
    expect(latestTaskOf(dataRoot, key).state).toBe("executed");
    expect(withDataRootStore(dataRoot, (store) => store.runStatus(fixture.task.id))).toEqual({ status: "none" });
  });

  it("fails the task with the label when a turn reports blocked", async () => {
    const fixture = await useExecuteFixture(
      { stream: turnResultStream("blocked", "No disk.") },
      { answer: { todos: TODOS } },
    );

    const { result, io } = await runExecute(fixture);

    const message = "todo `a` (Do a) reported blocked: No disk.";
    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(`${message}\n`);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
    expect(todoStates(fixture)).toEqual([
      ["b", "not_started"],
      ["a", "in_progress"],
    ]);
    expect(fixture.claude.calls()).toHaveLength(1);
  });

  it("fails the task with the label when a turn gives no result", async () => {
    const stream = claudeSampleWithResult("json-schema", (event) => {
      event.structured_output = { result: "maybe" };
    }).map((event) => JSON.stringify(event));
    const fixture = await useExecuteFixture({ stream }, { answer: { todos: TODOS } });

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("").startsWith("todo `a` (Do a) reported no result: ")).toBe(true);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
    expect(todoStates(fixture)).toContainEqual(["a", "in_progress"]);
  });

  it("fails the task when the assistant fails", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, exitCode: 1, stderr: "boom" },
      { answer: { todos: TODOS } },
    );

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toMatch(/^executing failed: .+\n$/);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
  });

  it("fails the task when a turn times out", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, untilStopped: true },
      { answer: { todos: TODOS }, limits: { executeTimeoutMin: 0.01 } },
    );

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe("executing timed out after 0.01 min\n");
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
  });

  it("blocks the task on a quota stop", async () => {
    const fixture = await useExecuteFixture(
      { stream: claudeSample("quota-stop"), exitCode: 1 },
      { answer: { todos: TODOS } },
    );

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.out.join("")).toMatch(/^executing stopped by a quota limit; /);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("quota_blocked");
  });

  it("writes one usage event for each turn", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });

    await runExecute(fixture);

    expect(eventTypes(fixture, ["usage"])).toHaveLength(2);
  });

  it("fails the task with executing failed when an unexpected error follows the move to executing", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });
    const transcripts = taskTranscriptsDir(fixture.config.dataRoot, fixture.task);
    writeFileWithParents(transcripts, "a file, not a folder");

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toMatch(/^executing failed: .+\n$/);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
    expect(fixture.claude.calls()).toEqual([]);
  });

  it("goes through executing to executed with no turn when no subject is left", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });
    withDataRootStore(fixture.config.dataRoot, (store) => store.markExecuteTodosDone(fixture.task.id, 1));

    const { result } = await runExecute(fixture);

    expect(result).toMatchObject({ todosDone: 2, todosTotal: 2, fixTurnDone: false });
    expect(fixture.claude.calls()).toEqual([]);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("executed");
    expect(eventTypes(fixture, ["executed"])[0].data).toEqual({
      version: 1,
      prompts: [],
      from: "executing",
      to: "executed",
    });
    expect(sessionRows(fixture.started.dataRoot)).toBe(0);
    expect(executePromptFiles(fixture.started.dataRoot)).toEqual([]);
  });

  it("keeps the events of two runs of one revision in one transcript", async () => {
    const blocked = turnResultStream("blocked", "No disk.");
    const fixture = await useExecuteFixture(
      { turns: [{ stream: doneStream }, { stream: blocked }, { stream: doneStream }] },
      { answer: { todos: TODOS } },
    );
    const { dataRoot } = fixture.started;

    const first = await runExecute(fixture);
    withDataRootStore(dataRoot, (store) => transitionTask(store, fixture.task.id, "approved"));
    const second = await runExecute(fixture);

    expect(first.result).toEqual({ exitCode: 1 });
    expect(second.result).toMatchObject({ todosDone: 2, todosTotal: 2 });
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(3);
    expect(argAfter(calls[2].argv, "--resume")).toBe(argAfter(calls[0].argv, "--session-id"));
    expect(calls[2].stdin).toBe(todoPrompt("b"));
    expect(transcriptLines(executeTranscriptPath(dataRoot, fixture.task, 1))).toEqual([
      ...doneStream,
      ...blocked,
      ...doneStream,
    ]);
  });
});

describe("executeTask protected workspace recovery", () => {
  const oneTodo = { answer: { todos: [planTodo("a")] } };
  const requestExec = shell(protectedRequestScript);
  const warnedDone = () => withEventBeforeResult(claudeApprovalWarningEvent(), doneStream);
  const ask = { repo: { overagePolicy: "ask" } };
  const assertIndexMatchesHead = async (fixture: ExecuteFixture) => {
    expect(await indexTreeOf(fixture)).toBe(await headTreeOf(fixture));
  };

  const startRecord = (fixture: ExecuteFixture, startingRevision: string, turnId = "todo:a") =>
    withDataRootStore(fixture.config.dataRoot, (store) =>
      store.beginProtectedExecuteTurn({
        taskId: fixture.task.id,
        planVersion: 1,
        turnId,
        startingRevision,
      }),
    );

  const rejectCompletionEvent = (fixture: ExecuteFixture, type: "todo_done" | "fix_turn_done") => {
    const trigger = `reject_${type}`;
    withRawDatabase(databasePathOf(fixture.config.dataRoot), (db) =>
      db.exec(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON events WHEN NEW.type = '${type}' BEGIN SELECT RAISE(ABORT, 'event rejected'); END`,
      ),
    );
    return () => withRawDatabase(databasePathOf(fixture.config.dataRoot), (db) => db.exec(`DROP TRIGGER ${trigger}`));
  };

  const completeRecord = (fixture: ExecuteFixture, turnId: string, startingRevision: string, endingRevision: string) =>
    withDataRootStore(fixture.config.dataRoot, (store) => {
      store.beginProtectedExecuteTurn({ taskId: fixture.task.id, planVersion: 1, turnId, startingRevision });
      store.recordProtectedExecuteTurnOutcome(fixture.task.id, 1, turnId, "succeeded", endingRevision);
      store.completeProtectedExecuteTurn(fixture.task.id, 1, turnId);
    });

  it("records and materializes a successful protected request before todo completion", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream, exec: requestExec }, oneTodo);
    const beforeRevision = await branchHeadOf(fixture);

    const { result } = await runExecute(fixture);

    const record = protectedTurnOf(fixture);
    const afterRevision = await branchHeadOf(fixture);
    expect(result).toMatchObject({ todosDone: 1, todosTotal: 1 });
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("executed");
    expect(todoStates(fixture)).toEqual([["a", "done"]]);
    expect(record).toMatchObject({
      startingRevision: beforeRevision,
      endingRevision: afterRevision,
      outcome: "succeeded",
      phase: "complete",
    });
    expect(readFileSync(join(fixture.started.worktree, protectedSkillPath), "utf8")).toBe(protectedSkillContent);
    await assertIndexMatchesHead(fixture);
    expect(await gitOutput({ cwd: fixture.started.worktree }, fixture.env, "status", "--porcelain")).toBe("");
    expect(fixture.claude.calls()).toHaveLength(1);
  });

  it("keeps live todo progress pending when its done event fails", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const release = rejectCompletionEvent(fixture, "todo_done");

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toContain("event rejected");
    expect(todoStates(fixture)).toEqual([["a", "in_progress"]]);
    expect(eventTypes(fixture, ["todo_done"])).toEqual([]);
    release();
  });

  it("keeps a live fix turn queued when its done event fails", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    withDataRootStore(fixture.config.dataRoot, (store) => {
      store.markExecuteTodosDone(fixture.task.id, 1);
      seedExecuteFixTurn(store, fixture.task.id, 1, "queued");
    });
    const release = rejectCompletionEvent(fixture, "fix_turn_done");

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toContain("event rejected");
    expect(withDataRootStore(fixture.config.dataRoot, (store) => store.executeFixTurnState(fixture.task.id, 1))).toBe(
      "queued",
    );
    expect(eventTypes(fixture, ["fix_turn_done"])).toEqual([]);
    release();
  });

  it("records a protected request during a continued session", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream, exec: requestExec }, oneTodo);
    const beforeRevision = await branchHeadOf(fixture);
    withDataRootStore(fixture.config.dataRoot, (store) => {
      seedExecuteSession(store, fixture.task.id, 1);
      seedExecuteTodoStates(store, fixture.task.id, 1, { a: "in_progress" });
    });

    await runExecute(fixture);

    expect(argAfter(fixture.claude.calls()[0].argv, "--resume")).toBe(TEST_EXECUTE_SESSION_ID);
    expect(protectedTurnOf(fixture)).toMatchObject({
      startingRevision: beforeRevision,
      endingRevision: await branchHeadOf(fixture),
      phase: "complete",
    });
    expect(readFileSync(join(fixture.started.worktree, protectedSkillPath), "utf8")).toBe(protectedSkillContent);
  });

  it("refuses an unknown starting revision before a model starts", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const beforeRevision = await branchHeadOf(fixture);
    startRecord(fixture, "d".repeat(40));

    await expect(runExecute(fixture)).rejects.toThrow(/starting revision/);

    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("approved");
    expect(todoStates(fixture)).toEqual([["a", "not_started"]]);
    expect(await branchHeadOf(fixture)).toBe(beforeRevision);
    expect(fixture.claude.calls()).toEqual([]);
  });

  it("recovers a committed request after retrying a failed assistant turn", async () => {
    const fixture = await useExecuteFixture(
      {
        turns: [
          { stream: doneStream, exec: requestExec, exitCode: 1, stderr: "stopped after commit" },
          { stream: doneStream, exec: shell("test -f .agents/skills/request.md") },
        ],
      },
      oneTodo,
    );
    const beforeRevision = await branchHeadOf(fixture);

    const first = await runExecute(fixture);

    expect(first.result).toEqual({ exitCode: 1 });
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
    expect(protectedTurnOf(fixture)).toMatchObject({
      startingRevision: beforeRevision,
      endingRevision: null,
      outcome: "failed",
      phase: "failed",
    });
    expect(existsSync(join(fixture.started.worktree, protectedSkillPath))).toBe(false);
    await assertIndexMatchesHead(fixture);

    const retried = await withDataRootStore(fixture.config.dataRoot, (store) =>
      retryTask(store, {
        config: fixture.config,
        ref: taskRefOf(fixture.started),
        taskId: fixture.task.id,
        resumeExecute: false,
        env: fixture.env,
        repoLockWaitMs: 1000,
      }),
    );
    const second = await runExecute(fixture);

    expect(retried.next).toBe("execute");
    expect(second.result).toMatchObject({ todosDone: 1, todosTotal: 1 });
    expect(readFileSync(join(fixture.started.worktree, protectedSkillPath), "utf8")).toBe(protectedSkillContent);
    expect(protectedTurnOf(fixture)).toMatchObject({
      endingRevision: await branchHeadOf(fixture),
      outcome: "failed",
      phase: "complete",
    });
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("executed");
    expect(fixture.claude.calls()).toHaveLength(2);
  });

  it("recovers an interrupted request before resuming the recorded session", async () => {
    const fixture = await useExecuteFixture(
      {
        turns: [
          {
            stream: doneStream,
            exec: shell(`${protectedRequestScript} && ${signalTasker("SIGINT")}`),
            untilStopped: true,
          },
          { stream: doneStream, exec: shell("test -f .agents/skills/request.md") },
        ],
      },
      oneTodo,
    );
    const beforeRevision = await branchHeadOf(fixture);

    await runExecute(fixture);

    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("interrupted");
    expect(protectedTurnOf(fixture)).toMatchObject({
      startingRevision: beforeRevision,
      endingRevision: null,
      outcome: "interrupted",
      phase: "interrupted",
    });
    expect(existsSync(join(fixture.started.worktree, protectedSkillPath))).toBe(false);
    const resumed = await withDataRootStore(fixture.config.dataRoot, (store) =>
      resumeTask(store, {
        ref: taskRefOf(fixture.started),
        taskId: fixture.task.id,
        config: fixture.config,
        env: fixture.env,
        repoLockWaitMs: 1000,
      }),
    );
    await runExecute(fixture);

    expect(resumed.next).toBe("execute");
    expect(argAfter(fixture.claude.calls()[1].argv, "--resume")).toBe(
      argAfter(fixture.claude.calls()[0].argv, "--session-id"),
    );
    expect(readFileSync(join(fixture.started.worktree, protectedSkillPath), "utf8")).toBe(protectedSkillContent);
    expect(protectedTurnOf(fixture)).toMatchObject({ outcome: "interrupted", phase: "complete" });
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("executed");
  });

  it("refuses a changed branch when a crash happened before the outcome was recorded", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, exec: shell("test -f .agents/skills/request.md") },
      oneTodo,
    );
    const { beforeRevision, afterRevision } = commitIndexChanges(
      fixture.started.worktree,
      fixture.started.branch,
      fixture.started.env,
      [{ path: protectedSkillPath, content: protectedSkillContent }],
    );
    startRecord(fixture, beforeRevision);

    await expect(runExecute(fixture)).rejects.toThrow(/unknown result for protected execute turn todo:a/);
    expect(await branchHeadOf(fixture)).toBe(afterRevision);
    expect(readFileSync(join(fixture.started.worktree, protectedSkillPath), "utf8")).toBe(protectedSkillContent);
    expect(protectedTurnOf(fixture)).toMatchObject({
      startingRevision: beforeRevision,
      endingRevision: null,
      phase: "started",
    });
    expect(fixture.claude.calls()).toEqual([]);
    expect(todoStates(fixture)).toEqual([["a", "not_started"]]);
  });

  it("refuses an unchanged branch when a started todo has no saved result", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const beforeRevision = await branchHeadOf(fixture);
    startRecord(fixture, beforeRevision);

    await expect(runExecute(fixture)).rejects.toThrow(/unknown result for protected execute turn todo:a/);

    expect(await branchHeadOf(fixture)).toBe(beforeRevision);
    expect(protectedTurnOf(fixture)).toMatchObject({
      startingRevision: beforeRevision,
      endingRevision: null,
      phase: "started",
    });
    expect(fixture.claude.calls()).toEqual([]);
    expect(todoStates(fixture)).toEqual([["a", "not_started"]]);
  });

  it("refuses a started fix turn before a continued model call", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const { beforeRevision } = commitIndexChanges(
      fixture.started.worktree,
      fixture.started.branch,
      fixture.started.env,
      [{ path: protectedSkillPath, content: protectedSkillContent }],
    );
    const turnId = withDataRootStore(fixture.config.dataRoot, (store) => {
      seedExecuteSession(store, fixture.task.id, 1);
      store.markExecuteTodosDone(fixture.task.id, 1);
      seedExecuteFixTurn(store, fixture.task.id, 1, "queued");
      return `fix:${store.queuedExecuteFixTurn(fixture.task.id, 1)!.queuedAt}`;
    });
    startRecord(fixture, beforeRevision, turnId);

    await expect(runExecute(fixture)).rejects.toThrow(
      new RegExp(`unknown result for protected execute turn ${turnId}`),
    );

    expect(protectedTurnOf(fixture, turnId)).toMatchObject({ endingRevision: null, phase: "started" });
    expect(withDataRootStore(fixture.config.dataRoot, (store) => store.executeFixTurnState(fixture.task.id, 1))).toBe(
      "queued",
    );
    expect(fixture.claude.calls()).toEqual([]);
  });

  it("replays a successful request after a crash with its ending revision recorded", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const { beforeRevision, afterRevision } = commitIndexChanges(
      fixture.started.worktree,
      fixture.started.branch,
      fixture.started.env,
      [{ path: protectedSkillPath, content: protectedSkillContent }],
    );
    withDataRootStore(fixture.config.dataRoot, (store) => {
      store.beginProtectedExecuteTurn({
        taskId: fixture.task.id,
        planVersion: 1,
        turnId: "todo:a",
        startingRevision: beforeRevision,
      });
      store.recordProtectedExecuteTurnOutcome(fixture.task.id, 1, "todo:a", "succeeded", afterRevision);
      store.setExecuteTodoState(fixture.task.id, 1, "a", "in_progress");
    });

    const { result } = await runExecute(fixture);

    expect(result).toMatchObject({ todosDone: 1, todosTotal: 1 });
    expect(fixture.claude.calls()).toEqual([]);
    expect(protectedTurnOf(fixture)).toMatchObject({
      startingRevision: beforeRevision,
      endingRevision: afterRevision,
      outcome: "succeeded",
      phase: "complete",
    });
    expect(readFileSync(join(fixture.started.worktree, protectedSkillPath), "utf8")).toBe(protectedSkillContent);
    await assertIndexMatchesHead(fixture);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("executed");
  });

  it("keeps recovered todo progress pending when its done event fails", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const { beforeRevision, afterRevision } = commitIndexChanges(
      fixture.started.worktree,
      fixture.started.branch,
      fixture.started.env,
      [{ path: protectedSkillPath, content: protectedSkillContent }],
    );
    withDataRootStore(fixture.config.dataRoot, (store) =>
      store.setExecuteTodoState(fixture.task.id, 1, "a", "in_progress"),
    );
    completeRecord(fixture, "todo:a", beforeRevision, afterRevision);
    const release = rejectCompletionEvent(fixture, "todo_done");

    await expect(runExecute(fixture)).rejects.toThrow("event rejected");

    expect(todoStates(fixture)).toEqual([["a", "in_progress"]]);
    expect(eventTypes(fixture, ["todo_done"])).toEqual([]);
    expect(fixture.claude.calls()).toEqual([]);
    release();
  });

  it("keeps a recovered fix turn queued when its done event fails", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const { beforeRevision, afterRevision } = commitIndexChanges(
      fixture.started.worktree,
      fixture.started.branch,
      fixture.started.env,
      [{ path: protectedSkillPath, content: protectedSkillContent }],
    );
    const turnId = withDataRootStore(fixture.config.dataRoot, (store) => {
      store.markExecuteTodosDone(fixture.task.id, 1);
      seedExecuteFixTurn(store, fixture.task.id, 1, "queued");
      return `fix:${store.queuedExecuteFixTurn(fixture.task.id, 1)!.queuedAt}`;
    });
    completeRecord(fixture, turnId, beforeRevision, afterRevision);
    const release = rejectCompletionEvent(fixture, "fix_turn_done");

    await expect(runExecute(fixture)).rejects.toThrow("event rejected");

    expect(withDataRootStore(fixture.config.dataRoot, (store) => store.executeFixTurnState(fixture.task.id, 1))).toBe(
      "queued",
    );
    expect(eventTypes(fixture, ["fix_turn_done"])).toEqual([]);
    expect(fixture.claude.calls()).toEqual([]);
    release();
  });

  it("recovers pending todo progress from a completed row in a continued run", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const { beforeRevision, afterRevision } = commitIndexChanges(
      fixture.started.worktree,
      fixture.started.branch,
      fixture.started.env,
      [{ path: protectedSkillPath, content: protectedSkillContent }],
    );
    withDataRootStore(fixture.config.dataRoot, (store) => {
      seedExecuteSession(store, fixture.task.id, 1);
      store.setExecuteTodoState(fixture.task.id, 1, "a", "in_progress");
    });
    completeRecord(fixture, "todo:a", beforeRevision, afterRevision);

    const { result } = await runExecute(fixture);

    expect(result).toMatchObject({ todosDone: 1, todosTotal: 1 });
    expect(eventTypes(fixture, ["todo_done"]).map((event) => event.type)).toEqual(["todo_done"]);
    expect(todoStates(fixture)).toEqual([["a", "done"]]);
    expect(fixture.claude.calls()).toEqual([]);
    expect(protectedTurnOf(fixture)).toMatchObject({ phase: "complete", outcome: "succeeded" });

    withDataRootStore(fixture.config.dataRoot, (store) => {
      transitionTask(store, fixture.task.id, "updating_branch");
      transitionTask(store, fixture.task.id, "approved");
    });
    const repeated = await runExecute(fixture);

    expect(repeated.result).toMatchObject({ todosDone: 1, todosTotal: 1 });
    expect(fixture.claude.calls()).toEqual([]);
    expect(eventTypes(fixture, ["todo_done"]).map((event) => event.type)).toEqual(["todo_done"]);
  });

  it("recovers pending fix-turn progress from a completed row in a continued run", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const { beforeRevision, afterRevision } = commitIndexChanges(
      fixture.started.worktree,
      fixture.started.branch,
      fixture.started.env,
      [{ path: protectedSkillPath, content: protectedSkillContent }],
    );
    const turnId = withDataRootStore(fixture.config.dataRoot, (store) => {
      seedExecuteSession(store, fixture.task.id, 1);
      store.markExecuteTodosDone(fixture.task.id, 1);
      seedExecuteFixTurn(store, fixture.task.id, 1, "queued");
      return `fix:${store.queuedExecuteFixTurn(fixture.task.id, 1)!.queuedAt}`;
    });
    completeRecord(fixture, turnId, beforeRevision, afterRevision);

    const { result } = await runExecute(fixture);

    expect(result).toMatchObject({ todosDone: 1, todosTotal: 1, fixTurnDone: true });
    expect(withDataRootStore(fixture.config.dataRoot, (store) => store.executeFixTurnState(fixture.task.id, 1))).toBe(
      "done",
    );
    expect(fixture.claude.calls()).toEqual([]);
    expect(protectedTurnOf(fixture, turnId)).toMatchObject({ phase: "complete", outcome: "succeeded" });
    expect(eventTypes(fixture, ["fix_turn_done"]).map((event) => event.type)).toEqual(["fix_turn_done"]);

    withDataRootStore(fixture.config.dataRoot, (store) => {
      transitionTask(store, fixture.task.id, "updating_branch");
      transitionTask(store, fixture.task.id, "approved");
    });
    await runExecute(fixture);

    expect(eventTypes(fixture, ["fix_turn_done"]).map((event) => event.type)).toEqual(["fix_turn_done"]);
  });

  const missingResultStream = claudeSampleWithResult("json-schema", (event) => {
    delete event.structured_output;
  }).map((event) => JSON.stringify(event));
  const nonDoneResults = [
    { name: "blocked", stream: turnResultStream("blocked", "No disk.") },
    { name: "missing", stream: missingResultStream },
  ] as const;

  it.each(nonDoneResults)("does not record a protected todo as succeeded for a $name result", async ({ stream }) => {
    const fixture = await useExecuteFixture({ stream, exec: requestExec }, oneTodo);

    const { result } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(protectedTurnOf(fixture)).not.toMatchObject({ outcome: "succeeded" });
    expect(todoStates(fixture)).toEqual([["a", "in_progress"]]);
    expect(fixture.claude.calls()).toHaveLength(1);
  });

  it.each(nonDoneResults)(
    "does not record a protected fix turn as succeeded for a $name result",
    async ({ stream }) => {
      const fixture = await useExecuteFixture({ stream, exec: requestExec }, oneTodo);
      withDataRootStore(fixture.config.dataRoot, (store) => {
        store.markExecuteTodosDone(fixture.task.id, 1);
        seedExecuteFixTurn(store, fixture.task.id, 1, "queued");
      });
      const turnId = withDataRootStore(
        fixture.config.dataRoot,
        (store) => `fix:${store.queuedExecuteFixTurn(fixture.task.id, 1)!.queuedAt}`,
      );

      const { result } = await runExecute(fixture);

      expect(result).toEqual({ exitCode: 1 });
      expect(protectedTurnOf(fixture, turnId)).not.toMatchObject({ outcome: "succeeded" });
      expect(withDataRootStore(fixture.config.dataRoot, (store) => store.executeFixTurnState(fixture.task.id, 1))).toBe(
        "queued",
      );
      expect(fixture.claude.calls()).toHaveLength(1);
    },
  );

  it("refuses a crash request with a partial index before another model starts", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const { beforeRevision } = commitIndexChanges(
      fixture.started.worktree,
      fixture.started.branch,
      fixture.started.env,
      [{ path: protectedSkillPath, content: protectedSkillContent }],
    );
    startRecord(fixture, beforeRevision);
    await gitOutput(
      { cwd: fixture.started.worktree },
      fixture.env,
      "update-index",
      "--force-remove",
      "--",
      protectedSkillPath,
    );
    const beforeWorktree = existsSync(join(fixture.started.worktree, protectedSkillPath));

    await expect(runExecute(fixture)).rejects.toThrow(/index/);

    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("approved");
    expect(existsSync(join(fixture.started.worktree, protectedSkillPath))).toBe(beforeWorktree);
    expect(fixture.claude.calls()).toEqual([]);
  });

  it("materializes and records the request before a quota pause", async () => {
    const fixture = await useExecuteFixture(
      { stream: warnedDone(), exec: requestExec },
      { answer: { todos: [planTodo("a")] }, ...ask },
    );

    const { result } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("awaiting_quota_approval");
    expect(todoStates(fixture)).toEqual([["a", "done"]]);
    expect(protectedTurnOf(fixture)).toMatchObject({ phase: "complete", outcome: "succeeded" });
    expect(readFileSync(join(fixture.started.worktree, protectedSkillPath), "utf8")).toBe(protectedSkillContent);
    expect(fixture.claude.calls()).toHaveLength(1);
  });

  it("preflights a pending record before no-turn completion", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, oneTodo);
    const startingRevision = await branchHeadOf(fixture);
    withDataRootStore(fixture.config.dataRoot, (store) => {
      store.markExecuteTodosDone(fixture.task.id, 1);
      store.beginProtectedExecuteTurn({
        taskId: fixture.task.id,
        planVersion: 1,
        turnId: "todo:a",
        startingRevision,
      });
    });

    await expect(runExecute(fixture)).rejects.toThrow(/unknown result for protected execute turn todo:a/);

    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("approved");
    expect(fixture.claude.calls()).toEqual([]);
    expect(eventTypes(fixture, ["executed"])).toEqual([]);
    expect(protectedTurnOf(fixture)).toMatchObject({ phase: "started", outcome: null });
  });

  it("keeps the exact Claude link on the worktree route and tracks mode 120000", async () => {
    const fixture = await useExecuteFixture(
      {
        stream: doneStream,
        exec: shell(
          "mkdir -p .agents/skills .claude && ln -s ../.agents/skills .claude/skills && git add -- .claude/skills && git -c user.name='Tasker Test' -c user.email='tasker-test@example.com' commit -m 'track Claude skills link'",
        ),
      },
      oneTodo,
    );

    await runExecute(fixture);

    expect(readlinkSync(join(fixture.started.worktree, ".claude/skills"))).toBe("../.agents/skills");
    expect(
      await gitOutput({ cwd: fixture.started.worktree }, fixture.env, "ls-tree", "HEAD", ".claude/skills"),
    ).toMatch(/^120000 blob /);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("executed");
  });

  it.each(["linked parent", "unrelated destination"])(
    "refuses a request with an %s before a later turn starts",
    async (blocker) => {
      const fixture = await useExecuteFixture(
        { stream: doneStream, exec: requestExec },
        { answer: { todos: [planTodo("a"), planTodo("b", ["a"])] } },
      );
      if (blocker === "linked parent") {
        const outside = join(fixture.started.dataRoot, "linked-parent-target");
        mkdirSync(outside);
        symlinkSync(outside, join(fixture.started.worktree, ".agents"));
      } else {
        mkdirSync(join(fixture.started.worktree, ".agents/skills"), { recursive: true });
        writeFileSync(join(fixture.started.worktree, protectedSkillPath), "unrelated content\n");
      }

      await runExecute(fixture);

      expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
      expect(todoStates(fixture)).toContainEqual(["a", "in_progress"]);
      expect(todoStates(fixture)).toContainEqual(["b", "not_started"]);
      expect(protectedTurnOf(fixture)).toMatchObject({ outcome: "succeeded", phase: "succeeded" });
      expect(fixture.claude.calls()).toHaveLength(1);
      if (blocker === "unrelated destination") {
        expect(readFileSync(join(fixture.started.worktree, protectedSkillPath), "utf8")).toBe("unrelated content\n");
      }
      await assertIndexMatchesHead(fixture);
    },
  );
});

describe("executeTask with a signal of tasker", () => {
  const interruptedTurns = [{ exec: shell(signalTasker("SIGINT")), untilStopped: true }];

  it("moves the task to interrupted and keeps the todo in_progress on a signal of tasker", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, turns: interruptedTurns },
      { answer: { todos: TODOS } },
    );

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("interrupted");
    expect(todoStates(fixture)).toContainEqual(["a", "in_progress"]);
    expect(io.out.join("")).toBe(
      "executing interrupted by SIGINT; run tasker resume codeguru42/tasker#5 to continue\n",
    );
    expect(fixture.claude.calls()).toHaveLength(1);
  });

  it("continues the session at the todo of an interrupted turn", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, turns: [...interruptedTurns, { stream: doneStream }] },
      { answer: { todos: TODOS } },
    );
    await runExecute(fixture);

    const resumed = await withDataRootStore(fixture.config.dataRoot, (store) =>
      resumeTask(store, {
        ref: taskRefOf(fixture.started),
        taskId: fixture.task.id,
        config: fixture.config,
        env: fixture.env,
        repoLockWaitMs: 1000,
      }),
    );
    await runExecute(fixture);

    expect(resumed.next).toBe("execute");
    const calls = fixture.claude.calls();
    expect(argAfter(calls[1].argv, "--resume")).toBe(argAfter(calls[0].argv, "--session-id"));
    expect(calls[1].stdin).toBe(todoPrompt("a"));
    expect(todoStates(fixture)).toContainEqual(["a", "done"]);
  });
});

describe("executeTask fix turn", () => {
  const ONE = [planTodo("a")];

  it("runs the queued fix turn after the open todos with the fix prompt", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: ONE } });
    withDataRootStore(fixture.config.dataRoot, (store) => seedExecuteFixTurn(store, fixture.task.id, 1, "queued"));

    const { result } = await runExecute(fixture);

    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(2);
    expect(calls[1].stdin).toBe(fixPrompt());
    expect(argAfter(calls[1].argv, "--resume")).toBe(argAfter(calls[0].argv, "--session-id"));
    expect(eventTypes(fixture, ["fix_turn_started", "fix_turn_done", "executed"]).map((event) => event.type)).toEqual([
      "fix_turn_started",
      "fix_turn_done",
      "executed",
    ]);
    expect(eventTypes(fixture, ["executed"])[0].data).toMatchObject({
      prompts: [
        promptVersion(EXECUTE_PROMPT_NAME, EXECUTE_PROMPT),
        promptVersion(EXECUTE_TODO_PROMPT_NAME, EXECUTE_TODO_PROMPT),
        promptVersion(EXECUTE_FIX_PROMPT_NAME, EXECUTE_FIX_PROMPT),
      ],
    });
    expect(withDataRootStore(fixture.config.dataRoot, (store) => store.executeFixTurnState(fixture.task.id, 1))).toBe(
      "done",
    );
    expect(result).toMatchObject({ fixTurnDone: true, todosDone: 1, todosTotal: 1 });
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("executed");
  });

  it("sends the prefix and the fix prompt when only the fix turn is left in a new session", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: ONE } });
    withDataRootStore(fixture.config.dataRoot, (store) => {
      store.markExecuteTodosDone(fixture.task.id, 1);
      seedExecuteFixTurn(store, fixture.task.id, 1, "queued");
    });

    const { result } = await runExecute(fixture);

    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].stdin).toBe(`${expectedPrefix(fixture, ONE, new Set(["a"]))}\n${fixPrompt()}`);
    expect(eventTypes(fixture, ["executed"])[0].data).toMatchObject({
      prompts: [
        promptVersion(EXECUTE_PROMPT_NAME, EXECUTE_PROMPT),
        promptVersion(EXECUTE_FIX_PROMPT_NAME, EXECUTE_FIX_PROMPT),
      ],
    });
    expect(result).toMatchObject({ fixTurnDone: true });
  });

  it("fails the task when the fix turn reports blocked", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, turns: [{ stream: doneStream }, { stream: turnResultStream("blocked", "No disk.") }] },
      { answer: { todos: ONE } },
    );
    withDataRootStore(fixture.config.dataRoot, (store) => seedExecuteFixTurn(store, fixture.task.id, 1, "queued"));

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe("the fix turn for the verify failure reported blocked: No disk.\n");
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
    expect(withDataRootStore(fixture.config.dataRoot, (store) => store.executeFixTurnState(fixture.task.id, 1))).toBe(
      "queued",
    );
  });
});

describe("executeTask denials and sandbox cleanup", () => {
  const denial = (command: string) => ({ tool_name: "Bash", tool_input: { command } });
  const denialStream = (command: string, result: "done" | "blocked" = "done") =>
    turnResultStream(result, undefined, (event) => {
      event.permission_denials = [denial(command)];
    });
  const seen = (command: string) => ({ tool: "Bash", input: { command } });

  it("writes one permission_denials event with all denials before the executed event", async () => {
    const fixture = await useExecuteFixture(
      { turns: [{ stream: denialStream("git push") }, { stream: denialStream("rm -rf x") }] },
      { answer: { todos: TODOS } },
    );

    const { result } = await runExecute(fixture);

    expect(eventTypes(fixture, ["permission_denials", "executed"]).map((event) => event.type)).toEqual([
      "permission_denials",
      "executed",
    ]);
    expect(eventTypes(fixture, ["permission_denials"])[0].data).toEqual({
      denials: [seen("git push"), seen("rm -rf x")],
    });
    expect(result).toMatchObject({ denials: 2 });
  });

  it("writes no permission_denials event when no turn had a denial", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });

    const { result } = await runExecute(fixture);

    expect(eventTypes(fixture, ["permission_denials"])).toEqual([]);
    expect(result).toMatchObject({ denials: 0 });
  });

  it("writes the permission_denials event before the move to failed", async () => {
    const fixture = await useExecuteFixture(
      { stream: denialStream("git push"), exitCode: 1, stderr: "boom" },
      { answer: { todos: TODOS } },
    );

    await runExecute(fixture);

    const types = eventsOf(fixture.started.dataRoot, fixture.started.key).map((event) => event.type);
    expect(types.filter((type) => type === "permission_denials")).toHaveLength(1);
    expect(types.indexOf("permission_denials")).toBeLessThan(types.lastIndexOf("transition"));
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
  });

  it("writes a sandbox_cleanup event with the sandboxCleanup of the outcome", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, placeholders: [".bashrc"] },
      { answer: { todos: [planTodo("a")] } },
    );

    await runExecute(fixture);

    expect(eventTypes(fixture, ["sandbox_cleanup"])).toEqual([
      { type: "sandbox_cleanup", data: { removed: [".bashrc"] } },
    ]);
  });
});

describe("executeTask deadline", { timeout: 20_000 }, () => {
  const slowDone = { stream: doneStream, sleepMs: 3000 };

  it("gives the second turn only the time that is left of the one deadline", async () => {
    const fixture = await useExecuteFixture(slowDone, {
      answer: { todos: TODOS },
      limits: { executeTimeoutMin: 1 },
    });
    const clock = () => (fixture.claude.calls().length >= 1 ? 60_000 - 500 : 0);

    const { result, io } = await runExecute(fixture, { clock });

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe("executing timed out after 1 min\n");
    expect(fixture.claude.calls()).toHaveLength(2);
    expect(todoStates(fixture)).toEqual([
      ["b", "in_progress"],
      ["a", "done"],
    ]);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
  });

  it("starts no turn when no time is left", async () => {
    const fixture = await useExecuteFixture(slowDone, {
      answer: { todos: TODOS },
      limits: { executeTimeoutMin: 1 },
    });
    const clock = () => (fixture.claude.calls().length >= 1 ? 60_000 : 0);

    const { result, io } = await runExecute(fixture, { clock });

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe("executing todo `b` (Do b) timed out after 1 min\n");
    expect(fixture.claude.calls()).toHaveLength(1);
    expect(todoStates(fixture)).toEqual([
      ["b", "not_started"],
      ["a", "done"],
    ]);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
  });
});

describe("executeTask push guard", () => {
  const pushMessage = async (fixture: ExecuteFixture): Promise<string> => {
    const sha = await fixture.started.origin.branchHead("main");
    return pushMessageExpected(fixture.started.branch, "absent", String(sha));
  };

  it("fails the task and keeps the todo done when the tip moved after a done turn", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, turns: [{ stream: doneStream, exec: pushBranch }] },
      { answer: { todos: TODOS } },
    );

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(`${await pushMessage(fixture)}\n`);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
    expect(todoStates(fixture)).toContainEqual(["a", "done"]);
    expect(fixture.claude.calls()).toHaveLength(1);
  });

  it("ends in failed, not in interrupted, when the tip moved after a turn with a signal", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, turns: [{ exec: shell(`${pushScript}; ${signalTasker("SIGINT")}`), untilStopped: true }] },
      { answer: { todos: TODOS } },
    );

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toContain(await pushMessage(fixture));
    expect(io.out.join("")).not.toContain("run tasker resume");
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
    expect(todoStates(fixture)).toContainEqual(["a", "in_progress"]);
  });

  it("ends in failed, not in quota_blocked, when the tip moved after a quota stop", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, turns: [{ stream: claudeSample("quota-stop"), exitCode: 1, exec: pushBranch }] },
      { answer: { todos: TODOS } },
    );

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toContain(await pushMessage(fixture));
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
  });

  it("keeps the first message and prints the push message when a failed turn also pushed", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, turns: [{ stream: doneStream, exitCode: 1, stderr: "boom", exec: pushBranch }] },
      { answer: { todos: TODOS } },
    );

    const { result, io } = await runExecute(fixture);

    const err = io.err.join("");
    expect(result).toEqual({ exitCode: 1 });
    expect(err).toMatch(/^executing failed: .+\n/);
    expect(err).toContain(`${await pushMessage(fixture)}\n`);
    expect(err).not.toContain("illegal state transition");
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
  });

  it("fails the task with the push error and does not pause when the tip moved after a turn with a warning", async () => {
    const fixture = await useExecuteFixture(
      { turns: [{ stream: withEventBeforeResult(claudeApprovalWarningEvent(), doneStream), exec: pushBranch }] },
      { answer: { todos: TODOS }, repo: { overagePolicy: "ask" } },
    );

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(`${await pushMessage(fixture)}\n`);
    expect(io.out).toEqual([]);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
    expect(
      eventsOf(fixture.started.dataRoot, fixture.started.key).filter(
        (event) => (event.data as { to?: string } | undefined)?.to === "awaiting_quota_approval",
      ),
    ).toEqual([]);
  });

  it("fails the task when the remote cannot be read after a turn", async () => {
    const fixture = await useExecuteFixture(
      { stream: doneStream, turns: [{ stream: doneStream, exec: moveOrigin }] },
      { answer: { todos: TODOS } },
    );

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("").startsWith("cannot read the remote after the run: ")).toBe(true);
    expect(latestTaskOf(fixture.started.dataRoot, fixture.started.key).state).toBe("failed");
  });
});

describe("executeTask quota warning", () => {
  const RESETS_AT = 1792206000;
  const ask = { repo: { overagePolicy: "ask" } };
  const warnedDone = () => withEventBeforeResult(claudeApprovalWarningEvent(), doneStream);
  const pauseData = { from: "executing", to: "awaiting_quota_approval", utilization: 0.95, resetsAt: RESETS_AT };
  const lastEvent = (fixture: ExecuteFixture) => eventsOf(fixture.started.dataRoot, fixture.started.key).at(-1);
  const stateOf = (fixture: ExecuteFixture) => latestTaskOf(fixture.started.dataRoot, fixture.started.key).state;

  it("pauses the task after the turn with the warning and keeps its todo done", async () => {
    const fixture = await useExecuteFixture({ stream: warnedDone() }, { answer: { todos: TODOS }, ...ask });

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.out.join("")).toBe(quotaPauseLineExpected("executing", 95, RESETS_AT));
    expect(io.err).toEqual([]);
    expect(stateOf(fixture)).toBe("awaiting_quota_approval");
    expect(lastEvent(fixture)).toEqual({ type: "transition", data: pauseData });
    expect(todoStates(fixture)).toEqual([
      ["b", "not_started"],
      ["a", "done"],
    ]);
    expect(fixture.claude.calls()).toHaveLength(1);
    expect(withDataRootStore(fixture.started.dataRoot, (store) => store.runStatus(fixture.task.id))).toEqual({
      status: "none",
    });
  });

  it("starts the next run at the next todo and ends in executed", async () => {
    const fixture = await useExecuteFixture(
      { turns: [{ stream: warnedDone() }, { stream: doneStream }] },
      { answer: { todos: TODOS }, ...ask },
    );
    const { dataRoot } = fixture.started;
    await runExecute(fixture);
    withDataRootStore(dataRoot, (store) => {
      seedCreditsApproval(store, fixture.task.id, RESETS_AT);
      transitionTask(store, fixture.task.id, "approved");
    });

    const { result } = await runExecute(fixture);

    const calls = fixture.claude.calls();
    expect(result).toMatchObject({ todosDone: 2, todosTotal: 2 });
    expect(calls).toHaveLength(2);
    expect(argAfter(calls[1].argv, "--resume")).toBe(argAfter(calls[0].argv, "--session-id"));
    expect(calls[1].stdin).toContain(currentTodoText(TODOS.find((todo) => todo.id === "b")!));
    expect(calls[1].stdin).not.toContain(currentTodoText(TODOS.find((todo) => todo.id === "a")!));
    expect(stateOf(fixture)).toBe("executed");
  });

  it("pauses after the last turn too, and the next run ends in executed with no new turn", async () => {
    const fixture = await useExecuteFixture({ stream: warnedDone() }, { answer: { todos: [planTodo("a")] }, ...ask });
    const { dataRoot } = fixture.started;

    const first = await runExecute(fixture);
    withDataRootStore(dataRoot, (store) => transitionTask(store, fixture.task.id, "approved"));
    const second = await runExecute(fixture);

    expect(first.result).toEqual({ exitCode: 1 });
    expect(second.result).toMatchObject({ todosDone: 1, todosTotal: 1 });
    expect(fixture.claude.calls()).toHaveLength(1);
    expect(stateOf(fixture)).toBe("executed");
  });

  it("pauses after the fix turn and records it as done", async () => {
    const fixture = await useExecuteFixture({ stream: warnedDone() }, { answer: { todos: [planTodo("a")] }, ...ask });
    withDataRootStore(fixture.started.dataRoot, (store) => {
      store.markExecuteTodosDone(fixture.task.id, 1);
      seedExecuteFixTurn(store, fixture.task.id, 1, "queued");
    });

    const { result } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(stateOf(fixture)).toBe("awaiting_quota_approval");
    expect(eventTypes(fixture, ["fix_turn_done"]).map((event) => event.type)).toEqual(["fix_turn_done"]);
    expect(withDataRootStore(fixture.config.dataRoot, (store) => store.executeFixTurnState(fixture.task.id, 1))).toBe(
      "done",
    );
  });

  it("fails the task, not pauses it, when the turn with the warning reports blocked", async () => {
    const stream = withEventBeforeResult(claudeApprovalWarningEvent(), turnResultStream("blocked", "No disk."));
    const fixture = await useExecuteFixture({ stream }, { answer: { todos: TODOS }, ...ask });

    const { result, io } = await runExecute(fixture);

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe("todo `a` (Do a) reported blocked: No disk.\n");
    expect(io.out).toEqual([]);
    expect(stateOf(fixture)).toBe("failed");
  });

  it("does not pause under decline", async () => {
    const fixture = await useExecuteFixture({ stream: warnedDone() }, { answer: { todos: TODOS } });

    const { result } = await runExecute(fixture);

    expect(result).toMatchObject({ todosDone: 2, todosTotal: 2 });
    expect(stateOf(fixture)).toBe("executed");
  });

  it("gives the approved window to the overage stop under decline", async () => {
    const fixture = await useExecuteFixture(
      { stream: withEventFirst(claudeOverageEvent(), doneStream) },
      { answer: { todos: TODOS } },
    );
    seedCreditsApprovalIn(fixture.started.dataRoot, fixture.task.id, RESETS_AT);

    const { result } = await runExecute(fixture);

    expect(result).toMatchObject({ todosDone: 2, todosTotal: 2 });
    expect(stateOf(fixture)).toBe("executed");
  });
});
