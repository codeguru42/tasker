import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config/schema.js";
import { promptVersion } from "../../src/prompts/archive.js";
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
import { baseRevisionOf } from "../../src/tasks/base-revision.js";
import { EXECUTE_COMMIT_TEXT } from "../../src/vcs/git/assistant-surface.js";
import { executeTask, type ExecuteRequest } from "../../src/tasks/execute.js";
import { captureIo } from "../helpers/cli.js";
import { realCommandPath } from "../helpers/fake-commands.js";
import { argAfter, claudeSample, claudeSampleWithResult, TEST_EXECUTE_SESSION_ID } from "../helpers/fake-claude.js";
import {
  planTodo,
  seedExecuteFixTurn,
  seedExecuteSession,
  seedExecuteTodoStates,
  transcriptLines,
  turnResultStream,
} from "../helpers/plan.js";
import { databasePathOf, eventsOf, latestTaskOf, withDataRootStore, withRawDatabase } from "../helpers/store.js";
import { type ExecuteFixture, expectRefusedWithoutChange, taskRefOf, useExecuteFixture } from "../helpers/task-fixtures.js";

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
    withDataRootStore(fixture.config.dataRoot, (store) => transitionTask(store, fixture.task.id, "awaiting_plan_review"));

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

  it("refuses a task that has no base event", async () => {
    const fixture = await useExecuteFixture({});
    withRawDatabase(databasePathOf(fixture.config.dataRoot), (db) => {
      // The events table refuses a delete, so the test removes its trigger first.
      db.exec("DROP TRIGGER events_no_delete");
      db.prepare("DELETE FROM events WHERE type = 'base'").run();
    });

    await expectRefused(fixture, "the task of codeguru42/tasker#5 has no base revision");
  });

  it("refuses a run when the remote cannot be read before the run", async () => {
    const fixture = await useExecuteFixture({});
    const repo = fixture.config.repos[fixture.started.repoKey]!;
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
  const baseRevision = withDataRootStore(dataRoot, (store) => baseRevisionOf(store, fixture.task.id))!;
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

describe("executeTask turns", () => {
  it("runs a new session in the dependency order with the prefix on the first turn only", async () => {
    const fixture = await useExecuteFixture({ stream: doneStream }, { answer: { todos: TODOS } });
    const { dataRoot } = fixture.started;
    const prefix = expectedPrefix(fixture, TODOS, new Set());

    const { result } = await runExecute(fixture);

    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.stdin).toBe(`${prefix}\n${todoPrompt("a")}`);
    expect(calls[1]!.stdin).toBe(todoPrompt("b"));
    const id = argAfter(calls[0]!.argv, "--session-id");
    expect(id).toBeDefined();
    expect(calls[0]!.argv).not.toContain("--resume");
    expect(argAfter(calls[1]!.argv, "--resume")).toBe(id);
    expect(withDataRootStore(dataRoot, (store) => store.executeSession(fixture.task.id, 1)?.sessionId)).toBe(id);
    expect(result).toMatchObject({ version: 1, todosDone: 2, todosTotal: 2, fixTurnDone: false, denials: 0 });
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
    expect(argAfter(calls[0]!.argv, "--resume")).toBe(TEST_EXECUTE_SESSION_ID);
    expect(calls[0]!.stdin).toBe(todoPrompt("b"));
    expect(eventTypes(fixture, ["executed"])[0]!.data).toMatchObject({
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
    const fixture = await useExecuteFixture({ stream: turnResultStream("blocked", "No disk.") }, { answer: { todos: TODOS } });

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
      event["structured_output"] = { result: "maybe" };
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
    mkdirSync(dirname(transcripts), { recursive: true });
    writeFileSync(transcripts, "a file, not a folder");

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
    expect(eventTypes(fixture, ["executed"])[0]!.data).toEqual({
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
    expect(argAfter(calls[2]!.argv, "--resume")).toBe(argAfter(calls[0]!.argv, "--session-id"));
    expect(calls[2]!.stdin).toBe(todoPrompt("b"));
    expect(transcriptLines(executeTranscriptPath(dataRoot, fixture.task, 1))).toEqual([
      ...doneStream,
      ...blocked,
      ...doneStream,
    ]);
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
    expect(calls[1]!.stdin).toBe(fixPrompt());
    expect(argAfter(calls[1]!.argv, "--resume")).toBe(argAfter(calls[0]!.argv, "--session-id"));
    expect(eventTypes(fixture, ["fix_turn_started", "fix_turn_done", "executed"]).map((event) => event.type)).toEqual([
      "fix_turn_started",
      "fix_turn_done",
      "executed",
    ]);
    expect(eventTypes(fixture, ["executed"])[0]!.data).toMatchObject({
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
    expect(calls[0]!.stdin).toBe(`${expectedPrefix(fixture, ONE, new Set(["a"]))}\n${fixPrompt()}`);
    expect(eventTypes(fixture, ["executed"])[0]!.data).toMatchObject({
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
      event["permission_denials"] = [denial(command)];
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
    expect(eventTypes(fixture, ["permission_denials"])[0]!.data).toEqual({
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
  // The fake claude is made before the origin is known, so its exec finds the origin in the cwd of the run:
  // the worktree is on the task branch, and its remote origin is the origin folder.
  const git = realCommandPath("git");
  const shell = (script: string) => [realCommandPath("sh"), "-c", script];
  const originOf = `o=$(${git} config remote.origin.url)`;
  // Makes the task branch on the origin at main, as a push from the session would.
  const pushBranch = shell(`${originOf}; ${git} --git-dir "$o" branch "$(${git} branch --show-current)" main`);
  // Moves the origin folder away, so that the remote cannot be read.
  const moveOrigin = shell(`${originOf}; ${realCommandPath("mv")} "$o" "$o-gone"`);

  const pushMessage = async (fixture: ExecuteFixture): Promise<string> => {
    const sha = await fixture.started.origin.branchHead("main");
    return `push detected on ${fixture.started.branch}: the tip of the branch on the remote moved from absent to ${sha}`;
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
