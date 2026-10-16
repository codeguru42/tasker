import { readFileSync } from "node:fs";
import type { AssistantEvent } from "../../src/assistant/provider.js";
import { approve } from "../../src/commands/approve.js";
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
import { runCommand } from "./cli.js";
import {
  claudeSampleWithResult,
  TEST_EXECUTE_SESSION_ID,
  TEST_REVIEW_SESSION_ID,
  TEST_SESSION_ID,
} from "./fake-claude.js";
import { useThreeRepoDataRoot } from "./config.js";
import { dayAt, eventsOf, latestTaskOf, type SeedTask, seedTasks, withDataRootStore } from "./store.js";

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

// A todo of a plan answer from its id and the ids it depends on, with change for other fields.
export function planTodo(
  id: string,
  dependsOn: readonly string[] = [],
  change: Partial<PlanAnswer["todos"][number]> = {},
): PlanAnswer["todos"][number] {
  return { id, title: `Do ${id}`, description: `The work of ${id}.`, depends_on: [...dependsOn], ...change };
}

// The stdout lines of a fake claude run that succeeds with output as its structured output.
// With edit, it changes the result event after the structured output is set.
function structuredOutputStream(output: unknown, edit?: (result: AssistantEvent) => void): string[] {
  return claudeSampleWithResult("json-schema", (result) => {
    result.structured_output = output;
    result.result = JSON.stringify(output);
    edit?.(result);
  }).map((event) => JSON.stringify(event));
}

// The stdout lines of a fake claude run that succeeds with answer as its structured output. It serves any structured
// answer: a plan, a review or another.
export function answerStream(answer: unknown): string[] {
  return structuredOutputStream(answer);
}

// The stdout lines of a fake claude run that succeeds with a turn result. With no reason, the result has no reason key.
// With edit, it changes the result event of the stream, for example to add permission_denials.
export function turnResultStream(
  result: "done" | "blocked",
  reason?: string,
  edit?: (event: AssistantEvent) => void,
): string[] {
  return structuredOutputStream(reason === undefined ? { result } : { result, reason }, edit);
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

// Inserts the next plan revision of the task (see seedPlanRevision) and approves it, so that it is the pinned revision.
// The task goes to state. The state must not be a spawning state.
// It writes the plan_revision event and no approved event.
export function seedPinnedPlanRevision(
  store: TaskStore,
  taskId: number,
  change: Partial<Omit<NewPlanRevision, "version">> = {},
  state = "approved",
): PlanRevision {
  const revision = seedPlanRevision(store, taskId, change, state);
  store.approvePlanRevision(taskId, revision.version, state);
  return store.pinnedPlanRevision(taskId)!;
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

// Queues a fix turn of a plan revision with the failure "npm test failed" and no log tail.
// With the state "done", it also marks the turn done.
export function seedExecuteFixTurn(
  store: TaskStore,
  taskId: number,
  version: number,
  state: "queued" | "done" = "queued",
): void {
  store.queueExecuteFixTurn(taskId, version, { verifyFailure: "npm test failed", verifyLogTail: null });
  if (state === "done") store.markExecuteFixTurnDone(taskId, version);
}

// Records a plan session for the task with TEST_SESSION_ID and the plan model of the test
// configurations, unless the call changes them.
export function seedPlanSession(store: TaskStore, taskId: number, change: Partial<NewSession> = {}): StoredSession {
  return store.recordPlanSession(taskId, {
    sessionId: TEST_SESSION_ID,
    provider: "claude-code",
    model: "opus",
    effort: "high",
    ...change,
  });
}

// Records the review session of a review number with TEST_REVIEW_SESSION_ID and the plan model of the test
// configurations, unless the call changes them.
export function seedReviewSession(
  store: TaskStore,
  taskId: number,
  number: number,
  change: Partial<NewSession> = {},
): StoredSession {
  return store.recordReviewSession(taskId, number, {
    sessionId: TEST_REVIEW_SESSION_ID,
    provider: "claude-code",
    model: "opus",
    effort: "high",
    ...change,
  });
}

// A task of codeguru42/tasker#5 (see seedPlanningTask) in awaiting_plan_review, with one plan revision for each entry
// of revisions, in order (see recordTestPlanRevision): v1 from a plan, each later one from a refine with the feedback
// "Refine v<N>." unless the entry gives other values. With no revision, the task moves to awaiting_plan_review alone.
// With approved, the revision of that version is approved right after its record, and the task goes back to
// awaiting_plan_review before the next revision.
export function seedPlanReviewTask(
  o: { revisions?: Partial<Omit<NewPlanRevision, "version">>[]; approved?: number } = {},
): { dataRoot: string; task: Task } {
  const { revisions = [{}], approved } = o;
  const { dataRoot, task } = seedPlanningTask();
  const seeded = withDataRootStore(dataRoot, (store) => {
    if (revisions.length === 0) transitionTask(store, task.id, "awaiting_plan_review");
    revisions.forEach((entry, i) => {
      if (i > 0) transitionTask(store, task.id, "refining");
      const change = i === 0 ? entry : { source: "refine" as const, feedback: `Refine v${i + 1}.`, ...entry };
      recordTestPlanRevision(store, dataRoot, task.id, change);
      if (i + 1 === approved) {
        store.approvePlanRevision(task.id, approved, "approved");
        transitionTask(store, task.id, "awaiting_plan_review");
      }
    });
    return store.getTask(task.id)!;
  });
  return { dataRoot, task: seeded };
}

// A task of codeguru42/tasker#5 in approved: the task of seedPlanReviewTask with o, then its newest revision is
// approved and pinned. It writes no approved event.
export function seedApprovedTask(
  o: { revisions?: Partial<Omit<NewPlanRevision, "version">>[]; approved?: number } = {},
): { dataRoot: string; task: Task } {
  const { dataRoot, task } = seedPlanReviewTask(o);
  const seeded = withDataRootStore(dataRoot, (store) => {
    store.approvePlanRevision(task.id, store.latestPlanRevision(task.id)!.version, "approved");
    return store.getTask(task.id)!;
  });
  return { dataRoot, task: seeded };
}

// Runs tasker approve for key in the repo codeguru42/tasker, the repo of the task of seedPlanReviewTask, with extra
// after the repo option.
export function runApprove(key = "codeguru42/tasker#5", ...extra: string[]) {
  return runCommand(approve, "approve", key, "--repo", "codeguru42/tasker", ...extra);
}

// The state and the events of the latest task of issueKey, and the approved_at of each version of the task taskId,
// as the store holds them now. A version with no revision gives undefined.
export function planStateSnapshot(dataRoot: string, issueKey: string, taskId: number, versions: readonly number[]) {
  return {
    state: latestTaskOf(dataRoot, issueKey).state,
    events: eventsOf(dataRoot, issueKey),
    approvedAt: versions.map((version) => planRevisionOf(dataRoot, taskId, version)?.approvedAt),
  };
}
