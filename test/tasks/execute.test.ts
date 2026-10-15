import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config/schema.js";
import { transitionTask } from "../../src/state/machine.js";
import { executeTranscriptPath, planRevisionPath } from "../../src/store/layout.js";
import { executeTask, type ExecuteRequest } from "../../src/tasks/execute.js";
import { captureIo } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { planTodo, seedExecuteSession } from "../helpers/plan.js";
import { databasePathOf, eventsOf, latestTaskOf, withDataRootStore, withRawDatabase } from "../helpers/store.js";
import { type ExecuteFixture, useExecuteFixture } from "../helpers/task-fixtures.js";

// Runs executeTask for the task of the fixture. change replaces fields of the request.
async function runExecute(fixture: ExecuteFixture, change: Partial<ExecuteRequest> = {}) {
  const io = captureIo();
  const { started, task, config, env } = fixture;
  const ref = { key: started.key, repoKey: started.repoKey, shortRef: "issue-5" };
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
// the state and the events as before, no new session row, no transcript, no claude call and no archived prompt.
async function expectRefused(
  fixture: ExecuteFixture,
  message: string,
  change: Partial<ExecuteRequest> = {},
): Promise<void> {
  const { dataRoot } = fixture.started;
  const { key } = fixture.started;
  const state = latestTaskOf(dataRoot, key).state;
  const events = eventsOf(dataRoot, key);
  const sessions = sessionRows(dataRoot);

  const error = await failureOf(runExecute(fixture, change), Error);

  expect(error.message.startsWith(message)).toBe(true);
  expect(latestTaskOf(dataRoot, key).state).toBe(state);
  expect(eventsOf(dataRoot, key)).toEqual(events);
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
