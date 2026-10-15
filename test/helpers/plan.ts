import { readFileSync } from "node:fs";
import type { PlanAnswer } from "../../src/plan/answer.js";
import { transitionTask, type TaskState } from "../../src/state/machine.js";
import { recordPlanRevision } from "../../src/store/plan-file.js";
import {
  type ExecuteTodoState,
  type NewPlanRevision,
  type NewSession,
  type PlanRevision,
  type StoredSession,
  type Task,
  type TaskStore,
} from "../../src/store/store.js";
import { claudeSampleWithResult, TEST_EXECUTE_SESSION_ID, TEST_SESSION_ID } from "./fake-claude.js";
import { useThreeRepoDataRoot } from "./config.js";
import { dayAt, type SeedTask, seedTasks, withDataRootStore } from "./store.js";

// The questions block that show-plan and show-questions print for the one open question of validPlanAnswer.
export const OPEN_QUESTION_BLOCK =
  "questions:\n  base-branch: Which branch is the base?\n    The issue names no base branch.\n    open\n";

export function validPlanAnswer(change: Partial<PlanAnswer> = {}): PlanAnswer {
  return {
    summary: ["Add the a module and its test."],
    plan_markdown: "## Summary\n\nAdd the a module and its test, test first.\n",
    files_changed: ["src/a.ts", "test/a.test.ts"],
    todos: [
      {
        id: "write-test",
        title: "Add the a module",
        description: "Write the failing test of the a module.",
        depends_on: [],
      },
      {
        id: "make-it-pass",
        title: "Add the a module",
        description: "Write the a module so that the test passes.",
        depends_on: ["write-test"],
      },
    ],
    questions: [
      {
        id: "base-branch",
        question: "Which branch is the base?",
        context: "The issue names no base branch.",
      },
    ],
    ...change,
  };
}

// The stdout lines of a fake claude run that succeeds with answer as its structured output.
export function planAnswerStream(answer: unknown): string[] {
  return claudeSampleWithResult("json-schema", (result) => {
    result["structured_output"] = answer;
    result["result"] = JSON.stringify(answer);
  }).map((event) => JSON.stringify(event));
}

// The next plan revision of the task: a valid plan answer, unless change gives other values.
function newPlanRevision(
  store: TaskStore,
  taskId: number,
  change: Partial<Omit<NewPlanRevision, "version">>,
): NewPlanRevision {
  return {
    source: "plan",
    answer: validPlanAnswer(),
    prompt: "plan@000000000000",
    ...change,
    version: store.nextPlanVersion(taskId),
  };
}

// Inserts the next plan revision of the task with addPlanRevision, with a valid answer unless change gives one.
// It sets state (not a spawning state) with no check, so it writes the plan_revision event and no transition event.
// It writes no plan file.
export function seedPlanRevision(
  store: TaskStore,
  taskId: number,
  change: Partial<Omit<NewPlanRevision, "version">> = {},
  state = "awaiting_plan_review",
): PlanRevision {
  const revision = newPlanRevision(store, taskId, change);
  store.addPlanRevision(taskId, revision, state);
  return store.getPlanRevision(taskId, revision.version)!;
}

// Creates the task of seed in the store of dataRoot (see seedTasks), then inserts its plan revision v1 with files as
// its files_changed (see seedPlanRevision). The task keeps the state of seed.
export function seedTaskWithPlanFiles(dataRoot: string, seed: SeedTask, files: readonly string[]): Task {
  const [task] = seedTasks(dataRoot, [seed]);
  withDataRootStore(dataRoot, (store) =>
    seedPlanRevision(store, task.id, { answer: validPlanAnswer({ files_changed: [...files] }) }, seed.state),
  );
  return task;
}

// A task of codeguru42/tasker#5 in the repo codeguru42/tasker, in the state planning,
// in the data root of the three-repo configuration.
export function seedPlanningTask(): { dataRoot: string; task: Task } {
  const { dataRoot } = useThreeRepoDataRoot();
  const [task] = seedTasks(dataRoot, [
    { issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state: "planning", at: dayAt(2) },
  ]);
  return { dataRoot, task };
}

// Revision version of the task in dataRoot, or undefined.
export function planRevisionOf(dataRoot: string, taskId: number, version: number): PlanRevision | undefined {
  return withDataRootStore(dataRoot, (store) => store.getPlanRevision(taskId, version));
}

// The lines of the file at path, with no empty last item.
export function transcriptLines(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

// Records the next plan revision of the task with recordPlanRevision: it writes the plan file and the row,
// and moves the task to `to` with the check of the state machine.
export function recordTestPlanRevision(
  store: TaskStore,
  dataRoot: string,
  taskId: number,
  change: Partial<Omit<NewPlanRevision, "version">> = {},
  to: TaskState = "awaiting_plan_review",
): Task {
  return recordPlanRevision(store, dataRoot, taskId, newPlanRevision(store, taskId, change), to);
}

// Records v1 of the task with first. With second, it moves the task to refining and records v2.
// Each revision gets its plan file, as recordTestPlanRevision writes it.
export function recordPlanRevisions(
  dataRoot: string,
  task: Task,
  first: Partial<Omit<NewPlanRevision, "version">> = {},
  second?: Partial<Omit<NewPlanRevision, "version">>,
): void {
  withDataRootStore(dataRoot, (store) => {
    recordTestPlanRevision(store, dataRoot, task.id, first);
    if (second !== undefined) {
      transitionTask(store, task.id, "refining");
      recordTestPlanRevision(store, dataRoot, task.id, second);
    }
  });
}

// Records the execute session of a plan revision with TEST_EXECUTE_SESSION_ID and the execute model of the test
// configurations, unless the call changes them.
export function seedExecuteSession(
  store: TaskStore,
  taskId: number,
  version: number,
  change: Partial<NewSession> = {},
): StoredSession {
  return store.recordExecuteSession(taskId, version, {
    sessionId: TEST_EXECUTE_SESSION_ID,
    provider: "claude-code",
    model: "sonnet",
    effort: "medium",
    ...change,
  });
}

// Sets the state of each todo that states names, in the order of the record, with setExecuteTodoState.
export function seedExecuteTodoStates(
  store: TaskStore,
  taskId: number,
  version: number,
  states: Readonly<Record<string, ExecuteTodoState>>,
): void {
  for (const [todoId, state] of Object.entries(states)) {
    store.setExecuteTodoState(taskId, version, todoId, state);
  }
}

// Records a plan session for the task with TEST_SESSION_ID and the plan model of the test
// configurations, unless the call changes them.
export function seedPlanSession(
  store: TaskStore,
  taskId: number,
  change: Partial<NewSession> = {},
): StoredSession {
  return store.recordPlanSession(taskId, {
    sessionId: TEST_SESSION_ID,
    provider: "claude-code",
    model: "opus",
    effort: "high",
    ...change,
  });
}
