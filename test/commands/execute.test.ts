import { describe, expect, it } from "vitest";
import { execute } from "../../src/commands/execute.js";
import { transitionTask } from "../../src/state/machine.js";
import { executeTranscriptPath } from "../../src/store/layout.js";
import { runCommand } from "../helpers/cli.js";
import { planTodo, seedExecuteFixTurn, turnResultStream } from "../helpers/plan.js";
import { eventsOf, latestTaskOf, seedDeadRun, withDataRootStore } from "../helpers/store.js";
import { type ExecuteFixture, expectNoAssistantRun, useExecuteFixture } from "../helpers/task-fixtures.js";
import { deadRunNote, wrongStateError } from "../helpers/state-commands.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const TODOS = [planTodo("a"), planTodo("b", ["a"])];

const runExecute = (key = KEY, ...extra: string[]) => runCommand(execute, "execute", key, ...extra);

const transcriptOf = (fixture: ExecuteFixture): string =>
  executeTranscriptPath(fixture.started.dataRoot, latestTaskOf(fixture.started.dataRoot, KEY), 1);

describe("tasker execute", () => {
  it("prints the result of a run of two todos and moves the task to executed", async () => {
    const fixture = await useExecuteFixture({ stream: turnResultStream("done") }, { answer: { todos: TODOS } });

    const result = await runExecute();

    expect(result).toEqual({
      code: 0,
      out: [
        `executed ${KEY} at revision v1`,
        "todos: 2 of 2 done",
        "denials: 0",
        `transcript: ${transcriptOf(fixture)}`,
        "",
      ].join("\n"),
      err: "",
    });
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("executed");
  });

  it("prints the fix turn line when the run did the fix turn", async () => {
    const fixture = await useExecuteFixture({ stream: turnResultStream("done") }, { answer: { todos: [TODOS[0]] } });
    withDataRootStore(fixture.started.dataRoot, (store) => seedExecuteFixTurn(store, fixture.task.id, 1, "queued"));

    const result = await runExecute();

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      [
        `executed ${KEY} at revision v1`,
        "todos: 1 of 1 done",
        "fix turn: done",
        "denials: 0",
        `transcript: ${transcriptOf(fixture)}`,
        "",
      ].join("\n"),
    );
  });

  it("refuses a task that is not in approved, with the message on stderr and no write", async () => {
    const fixture = await useExecuteFixture({ stream: turnResultStream("done") });
    withDataRootStore(fixture.started.dataRoot, (store) =>
      transitionTask(store, fixture.task.id, "awaiting_plan_review"),
    );
    const events = eventsOf(fixture.started.dataRoot, KEY);

    const result = await runExecute();

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `${wrongStateError("awaiting_plan_review", KEY, "execute", "approved")}\n`,
    });
    expect(eventsOf(fixture.started.dataRoot, KEY)).toEqual(events);
    expect(fixture.claude.calls()).toEqual([]);
  });

  it("moves a dead run to interrupted, prints the note, then refuses and runs no assistant", async () => {
    const fixture = await useExecuteFixture({ stream: turnResultStream("done") });
    seedDeadRun(fixture.started.dataRoot, fixture.task.id, "executing");

    const result = await runExecute();

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `${deadRunNote(KEY, "executing")}\n` + `${wrongStateError("interrupted", KEY, "execute", "approved")}\n`,
    });
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("interrupted");
    expectNoAssistantRun(fixture);
  });

  it("exits with 1 and prints no output line when a turn fails", async () => {
    const fixture = await useExecuteFixture(
      { stream: turnResultStream("blocked", "No disk.") },
      { answer: { todos: [TODOS[0]] } },
    );

    const result = await runExecute();

    expect(result).toEqual({ code: 1, out: "", err: "todo `a` (Do a) reported blocked: No disk.\n" });
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
  });

  it("takes the repo from --repo", async () => {
    await useExecuteFixture({ stream: turnResultStream("done") }, { answer: { todos: [TODOS[0]] } });

    const result = await runExecute(KEY, "--repo", REPO);

    expect(result.code).toBe(0);
    expect(result.out.startsWith(`executed ${KEY} at revision v1\n`)).toBe(true);
  });
});
