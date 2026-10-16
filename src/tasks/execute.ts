import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { PermissionDenial } from "../assistant/provider.js";
import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import type { PlanAnswer } from "../plan/answer.js";
import { orderTodos } from "../plan/todo-order.js";
import { readTurnResult, turnResultJsonSchema } from "../plan/turn-result.js";
import { archivePrompt } from "../prompts/archive.js";
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
} from "../prompts/execute.js";
import { fillTemplate } from "../prompts/template.js";
import { transitionTask, transitionWithExecution } from "../state/machine.js";
import { executeTranscriptPath } from "../store/layout.js";
import { withTaskLock } from "../store/locks.js";
import { readPlanFile } from "../store/plan-file.js";
import { type ExecuteFixTurn, type TaskStore } from "../store/store.js";
import { type RemoteTip, vcsForRepo } from "../vcs/provider.js";
import { tipMoved } from "../vcs/remote-tip.js";
import { prepareTaskExecuteRun } from "./assistant-run.js";
import { applyRunOutcome, failRun } from "./run-outcome.js";
import { assertSessionModel } from "./session-model.js";
import { requireBaseRevision, requireBranch, taskInState } from "./task-state.js";

type PlanTodo = PlanAnswer["todos"][number];

// One turn of the run: a todo or the fix turn, with the words that name it in a message.
type Subject = { kind: "todo"; todo: PlanTodo; label: string } | { kind: "fix"; turn: ExecuteFixTurn; label: string };

export interface ExecuteRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The execute reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
  // The clock of the deadline, in milliseconds. The default is Date.now. The deadline tests give their own clock.
  clock?: () => number;
}

export interface ExecutedRun {
  version: number;
  todosDone: number;
  todosTotal: number;
  // True when this run did the fix turn.
  fixTurnDone: boolean;
  // The count of the permission denials of all turns of this run.
  denials: number;
  transcriptPath: string;
}

// A result with exitCode means that the run step already printed the message.
export type ExecuteResult = ExecutedRun | { exitCode: number };

// Carries out the pinned plan revision of a task in approved, one turn for each todo that is not done.
// The task lock covers all the steps. It does not wait.
export async function executeTask(store: TaskStore, request: ExecuteRequest): Promise<ExecuteResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => executeLocked(store, request));
}

async function executeLocked(store: TaskStore, request: ExecuteRequest): Promise<ExecuteResult> {
  const { config, env, io } = request;
  const task = taskInState(store, request.taskId, "approved", "execute");
  const revision = store.pinnedPlanRevision(task.id);
  if (revision === undefined) throw new Error(`the task of ${task.issueKey} is approved, but no revision is pinned`);
  const version = revision.version;
  const planText = readPlanFile(config.dataRoot, task, version);
  const ordered = orderTodos(revision.answer.todos);
  const baseRevision = requireBaseRevision(store, task);
  const branch = requireBranch(task);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  let before: RemoteTip;
  try {
    before = await vcs.remoteTaskRefTip(ctx, { taskRef: branch });
  } catch (error) {
    throw new Error(`cannot read the remote before the run: ${errorMessage(error)}`, { cause: error });
  }
  const stored = store.executeSession(task.id, version);
  if (stored) await assertSessionModel(stored, env, `the execute session of ${task.issueKey}`);
  const prepared = await prepareTaskExecuteRun({
    config,
    store,
    task,
    env,
    session: stored ? { resume: true, sessionId: stored.sessionId, recorded: stored } : { resume: false },
  });

  const progress = store.executeTodoProgress(task.id, version);
  const doneIds = new Set(progress.filter((entry) => entry.state === "done").map((entry) => entry.todo.id));
  const subjects: Subject[] = ordered
    .filter((todo) => !doneIds.has(todo.id))
    .map((todo) => ({ kind: "todo", todo, label: `todo \`${todo.id}\` (${todo.title})` }));
  const fixTurn = store.queuedExecuteFixTurn(task.id, version);
  if (fixTurn !== undefined) {
    subjects.push({ kind: "fix", turn: fixTurn, label: "the fix turn for the verify failure" });
  }
  // The prompts that this run sends, filled and archived. The list holds their versions.
  const prompts: string[] = [];
  let prefix: string | undefined;
  if (stored === undefined && subjects.length > 0) {
    prefix = fillTemplate(EXECUTE_PROMPT_NAME, EXECUTE_PROMPT, {
      COMMIT_RULES: fillTemplate("commit-rules", prepared.executeCommitText, { BASE_REF: baseRevision }),
      PLAN_MARKDOWN: planText,
      TODOS: todosText(revision.answer.todos, doneIds),
      RESOLVED_QUESTIONS: resolvedQuestionsText(store.resolvedQuestionsThrough(task.id, version)),
    });
    prompts.push(archivePrompt(config.dataRoot, EXECUTE_PROMPT_NAME, EXECUTE_PROMPT).version);
  }
  if (subjects.some((subject) => subject.kind === "todo")) {
    prompts.push(archivePrompt(config.dataRoot, EXECUTE_TODO_PROMPT_NAME, EXECUTE_TODO_PROMPT).version);
  }
  if (fixTurn !== undefined) {
    prompts.push(archivePrompt(config.dataRoot, EXECUTE_FIX_PROMPT_NAME, EXECUTE_FIX_PROMPT).version);
  }
  // A run with no subject records no session: an id that no conversation holds must not be continued.
  if (stored === undefined && subjects.length > 0) {
    store.recordExecuteSession(task.id, version, {
      sessionId: prepared.sessionId,
      provider: prepared.session.provider,
      model: prepared.session.model,
      effort: prepared.session.effort,
    });
  }

  transitionTask(store, task.id, "executing");
  // The denials of all turns. One permission_denials event holds them, written right before the move out of executing.
  const denials: PermissionDenial[] = [];
  let denialsWritten = false;
  const flushDenials = (): void => {
    if (denialsWritten || denials.length === 0) return;
    denialsWritten = true;
    store.appendEvent(task.id, "permission_denials", { denials });
  };
  // Fails the task with message: from executing or quota_blocked, the move to failed with the message.
  // From failed, only the message on stderr, because a move from failed to failed is illegal.
  const fail = (message: string): { exitCode: number } => {
    if (store.getTask(task.id)!.state === "failed") {
      io.stderr(`${message}\n`);
      return { exitCode: 1 };
    }
    flushDenials();
    return failRun(store, task, io, message);
  };
  const transcriptPath = executeTranscriptPath(config.dataRoot, task, version);
  let fixTurnDone = false;
  try {
    mkdirSync(dirname(transcriptPath), { recursive: true });
    const fd = openSync(transcriptPath, "a");
    try {
      const limitMin = config.limits.executeTimeoutMin;
      const clock = request.clock ?? Date.now;
      // One deadline for all turns, read once before the first turn.
      const deadline = clock() + limitMin * 60_000;
      let first = stored === undefined;
      for (const subject of subjects) {
        const { label } = subject;
        const left = deadline - clock();
        if (left <= 0) return fail(`executing ${label} timed out after ${limitMin} min`);
        let turnPrompt: string;
        if (subject.kind === "todo") {
          store.setExecuteTodoState(task.id, version, subject.todo.id, "in_progress");
          store.appendEvent(task.id, "todo_started", { id: subject.todo.id });
          turnPrompt = fillTemplate(EXECUTE_TODO_PROMPT_NAME, EXECUTE_TODO_PROMPT, {
            CURRENT_TODO: currentTodoText(subject.todo),
          });
        } else {
          store.appendEvent(task.id, "fix_turn_started");
          turnPrompt = fillTemplate(EXECUTE_FIX_PROMPT_NAME, EXECUTE_FIX_PROMPT, {
            VERIFY_FAILURE: subject.turn.verifyFailure,
            VERIFY_LOG: subject.turn.verifyLogTail ?? NO_VERIFY_LOG,
          });
        }
        const prompt = first && prefix !== undefined ? `${prefix}\n${turnPrompt}` : turnPrompt;
        first = false;
        const outcome = await prepared.start({
          prompt,
          jsonSchema: turnResultJsonSchema(),
          onEvent: (event) => writeSync(fd, `${JSON.stringify(event)}\n`),
          timeoutMs: left,
        });
        denials.push(...outcome.permissionDenials);
        if (outcome.kind !== "success") flushDenials();
        const result = applyRunOutcome({ store, task, phase: "executing", timeoutMinutes: limitMin, io, outcome });
        const read = "outcome" in result ? readTurnResult(result.outcome.structuredOutput) : undefined;
        if (read?.kind === "done") {
          if (subject.kind === "todo") {
            store.setExecuteTodoState(task.id, version, subject.todo.id, "done");
            store.appendEvent(task.id, "todo_done", { id: subject.todo.id });
          } else {
            store.markExecuteFixTurnDone(task.id, version);
            store.appendEvent(task.id, "fix_turn_done");
            fixTurnDone = true;
          }
        }
        if (outcome.sandboxCleanup !== undefined) {
          store.appendEvent(task.id, "sandbox_cleanup", outcome.sandboxCleanup);
        }
        // Layer 3 of the push guard: the tip of the task branch on the remote must not move. A push wins over
        // every outcome, a quota stop included.
        let pushed: string | undefined;
        try {
          const moved = tipMoved(before, await vcs.remoteTaskRefTip(ctx, { taskRef: branch }));
          if (moved !== undefined) pushed = `push detected on ${branch}: ${moved}`;
        } catch (error) {
          pushed = `cannot read the remote after the run: ${errorMessage(error)}`;
        }
        if (pushed !== undefined) return fail(pushed);
        if ("exitCode" in result) return result;
        if (read?.kind === "blocked") return fail(`${label} reported blocked: ${read.reason}`);
        if (read?.kind === "none") return fail(`${label} reported no result: ${read.detail}`);
      }
    } finally {
      closeSync(fd);
    }
    flushDenials();
    transitionWithExecution(store, task.id, version, prompts);
  } catch (error) {
    return fail(`executing failed: ${errorMessage(error)}`);
  }
  const after = store.executeTodoProgress(task.id, version);
  return {
    version,
    todosDone: after.filter((entry) => entry.state === "done").length,
    todosTotal: after.length,
    fixTurnDone,
    denials: denials.length,
    transcriptPath,
  };
}
