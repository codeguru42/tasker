import { closeSync, openSync, writeSync } from "node:fs";
import { makeParentFolders } from "../parent-folders.js";
import type { PermissionDenial } from "../assistant/provider.js";
import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { errorMessage } from "../error-message.js";
import type { IssueRef } from "../issue-key/ref.js";
import type { PlanAnswer } from "../plan/answer.js";
import { orderTodos } from "../plan/todo-order.js";
import { checkTurnResult, readTurnResult, turnResultJsonSchema } from "../plan/turn-result.js";
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
import { approvedResetsAtOf, transitionTask, transitionWithExecution } from "../state/machine.js";
import { executeTranscriptPath } from "../store/layout.js";
import { withTaskLock } from "../store/locks.js";
import { readPlanFile } from "../store/plan-file.js";
import { type ExecuteFixTurn, type ProtectedExecuteTurn, type TaskStore } from "../store/store.js";
import { vcsForRepo } from "../vcs/provider.js";
import { prepareTaskExecuteRun } from "./assistant-run.js";
import {
  applyRunOutcome,
  failRun,
  interruptedLine,
  pauseForQuotaApproval,
  recordSandboxCleanup,
} from "./run-outcome.js";
import { assertSessionModel } from "./session-model.js";
import { assertBaseMoved } from "./parent.js";
import { requireBaseRevision, requireBranch, taskInState } from "./task-state.js";
import { startTipGuard } from "./tip-guard.js";

type PlanTodo = PlanAnswer["todos"][number];

// One turn of the run: a todo or the fix turn, with the words that name it in a message.
type Subject = { kind: "todo"; todo: PlanTodo; label: string } | { kind: "fix"; turn: ExecuteFixTurn; label: string };

function turnIdFor(subject: Subject): string {
  return subject.kind === "todo" ? `todo:${subject.todo.id}` : `fix:${subject.turn.queuedAt}`;
}

function turnIdsFor(store: TaskStore, taskId: number, version: number, base: string): string[] {
  const ids: string[] = [];
  for (let attempt = 1; ; attempt += 1) {
    const id = attempt === 1 ? base : `${base}:${attempt}`;
    if (store.protectedExecuteTurn(taskId, version, id) === undefined) break;
    ids.push(id);
  }
  return ids;
}

async function reconcileProtectedTurn(
  store: TaskStore,
  vcs: ReturnType<typeof vcsForRepo>["vcs"],
  ctx: ReturnType<typeof vcsForRepo>["ctx"],
  task: ReturnType<typeof taskInState>,
  turn: ProtectedExecuteTurn,
  deniedPaths: readonly string[],
): Promise<ProtectedExecuteTurn> {
  if (task.worktreePath === null) throw new Error(`task ${task.id} has no worktree for protected recovery`);

  if (turn.phase === "complete") {
    const branch = requireBranch(task);
    const state = await vcs.workspaceState(ctx, { path: task.worktreePath });
    const branchRevision = await vcs.taskRefRevision(ctx, { taskRef: branch });
    if (
      turn.endingRevision === null ||
      state.head !== turn.endingRevision ||
      state.taskRef !== branch ||
      branchRevision !== turn.endingRevision
    ) {
      throw new Error(`completed protected execute turn ${turn.turnId} no longer matches the task branch and worktree`);
    }
    await vcs.materializeProtectedWorkspaceChanges(ctx, {
      path: task.worktreePath,
      taskRef: branch,
      beforeRevision: turn.startingRevision,
      afterRevision: turn.endingRevision,
      deniedPaths,
    });
    return turn;
  }

  if (turn.phase === "started" && turn.outcome === null) {
    throw new Error(`unknown result for protected execute turn ${turn.turnId}; recovery cannot continue`);
  }

  let endingRevision = turn.endingRevision;
  if (endingRevision === null) {
    endingRevision = (await vcs.workspaceState(ctx, { path: task.worktreePath })).head;
    store.recordProtectedExecuteTurnEndingRevision(task.id, turn.planVersion, turn.turnId, endingRevision);
  }
  await vcs.materializeProtectedWorkspaceChanges(ctx, {
    path: task.worktreePath,
    taskRef: requireBranch(task),
    beforeRevision: turn.startingRevision,
    afterRevision: endingRevision,
    deniedPaths,
  });
  return store.completeProtectedExecuteTurn(task.id, turn.planVersion, turn.turnId);
}

async function reconcilePendingProtectedTurns(
  store: TaskStore,
  vcs: ReturnType<typeof vcsForRepo>["vcs"],
  ctx: ReturnType<typeof vcsForRepo>["ctx"],
  task: ReturnType<typeof taskInState>,
  version: number,
  subjects: readonly Subject[],
  deniedPaths: readonly string[],
): Promise<boolean> {
  let fixTurnDone = false;
  const bases = new Set(subjects.map(turnIdFor));
  // Include every todo identity, even when it is already done or no turn remains to run.
  for (const progress of store.executeTodoProgress(task.id, version)) bases.add(`todo:${progress.todo.id}`);
  for (const base of bases) {
    for (const id of turnIdsFor(store, task.id, version, base)) {
      const turn = store.protectedExecuteTurn(task.id, version, id)!;
      if (turn.phase === "complete") {
        if (turn.outcome !== "succeeded") continue;
        if (base.startsWith("todo:")) {
          const todoId = base.slice("todo:".length);
          const current = store.executeTodoProgress(task.id, version).find((entry) => entry.todo.id === todoId);
          if (current?.state === "done") continue;
        } else if (store.executeFixTurnState(task.id, version) !== "queued") {
          continue;
        }
      }
      const completed = await reconcileProtectedTurn(store, vcs, ctx, task, turn, deniedPaths);
      if (completed.outcome === "succeeded") {
        if (base.startsWith("todo:")) {
          const todoId = base.slice("todo:".length);
          const current = store.executeTodoProgress(task.id, version).find((entry) => entry.todo.id === todoId);
          if (current?.state !== "done") {
            store.completeExecuteTodo(task.id, version, todoId);
          }
        } else {
          if (store.executeFixTurnState(task.id, version) === "queued") {
            fixTurnDone = store.completeExecuteFixTurn(task.id, version, base.slice("fix:".length)) || fixTurnDone;
          }
        }
      }
    }
  }
  return fixTurnDone;
}

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
  const task = taskInState(store, request.taskId, "execute");
  assertBaseMoved(store, task);
  const revision = store.pinnedPlanRevision(task.id);
  if (revision === undefined) throw new Error(`the task of ${task.issueKey} is approved, but no revision is pinned`);
  const version = revision.version;
  const planText = readPlanFile(config.dataRoot, task, version);
  const ordered = orderTodos(revision.answer.todos);
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  const baseRevision = requireBaseRevision(vcs, task);
  const branch = requireBranch(task);
  const tipGuard = await startTipGuard(vcs, ctx, branch);
  const stored = store.executeSession(task.id, version);
  if (stored) await assertSessionModel(stored, env, `the execute session of ${task.issueKey}`);
  const prepared = await prepareTaskExecuteRun({
    config,
    store,
    task,
    env,
    session: stored ? { resume: true, sessionId: stored.sessionId, recorded: stored } : { resume: false },
    approvedResetsAt: approvedResetsAtOf(store, task.id),
  });

  const initialSubjects: Subject[] = [];
  const initialFixTurn = store.queuedExecuteFixTurn(task.id, version);
  if (initialFixTurn !== undefined) {
    initialSubjects.push({ kind: "fix", turn: initialFixTurn, label: "the fix turn for the verify failure" });
  }
  // Reconcile every saved request before this run starts a model, including a no-turn completion.
  const recoveredFixTurnDone = await reconcilePendingProtectedTurns(
    store,
    vcs,
    ctx,
    task,
    version,
    initialSubjects,
    prepared.deniedReadPaths,
  );

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
      trustedExtensions: prepared.session.trustedExtensions,
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
  // Fails the task with message: from executing, quota_blocked or interrupted, the move to failed with the message.
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
  let fixTurnDone = recoveredFixTurnDone;
  try {
    makeParentFolders(transcriptPath);
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
        const turnBase = turnIdFor(subject);
        const priorTurns = turnIdsFor(store, task.id, version, turnBase);
        const turnId = priorTurns.length === 0 ? turnBase : `${turnBase}:${priorTurns.length + 1}`;
        const startingRevision = (await vcs.workspaceState(ctx, { path: task.worktreePath! })).head;
        store.beginProtectedExecuteTurn({
          taskId: task.id,
          planVersion: version,
          turnId,
          startingRevision,
        });
        const prompt = first && prefix !== undefined ? `${prefix}\n${turnPrompt}` : turnPrompt;
        first = false;
        const outcome = await prepared.start({
          prompt,
          jsonSchema: turnResultJsonSchema(),
          checkAnswer: checkTurnResult,
          onEvent: (event) => writeSync(fd, `${JSON.stringify(event)}\n`),
          timeoutMs: left,
        });
        denials.push(...outcome.permissionDenials);
        const read = outcome.kind === "success" ? readTurnResult(outcome.structuredOutput) : undefined;
        if (outcome.kind === "success") {
          const endingRevision = (await vcs.workspaceState(ctx, { path: task.worktreePath! })).head;
          store.recordProtectedExecuteTurnOutcome(
            task.id,
            version,
            turnId,
            read?.kind === "done" ? "succeeded" : "failed",
            read?.kind === "done" ? endingRevision : undefined,
          );
          const protectedTurn = store.protectedExecuteTurn(task.id, version, turnId)!;
          await reconcileProtectedTurn(store, vcs, ctx, task, protectedTurn, prepared.deniedReadPaths);
        } else {
          store.recordProtectedExecuteTurnOutcome(
            task.id,
            version,
            turnId,
            outcome.kind === "interrupted" ? "interrupted" : "failed",
          );
        }
        if (outcome.kind !== "success") flushDenials();
        const result = applyRunOutcome({
          store,
          task,
          phase: "executing",
          timeoutMinutes: limitMin,
          io,
          outcome,
          quota: { repo: config.repos[task.repoKey], prepared },
          omitInterruptedLine: true,
        });
        if (read?.kind === "done") {
          if (subject.kind === "todo") {
            store.completeExecuteTodo(task.id, version, subject.todo.id);
          } else {
            fixTurnDone = store.completeExecuteFixTurn(task.id, version, subject.turn.queuedAt) || fixTurnDone;
          }
        }
        recordSandboxCleanup(store, task, outcome);
        const pushed = await tipGuard.tipFailure();
        if (pushed !== undefined) return fail(pushed);
        if (outcome.kind === "interrupted") io.stdout(interruptedLine("executing", outcome.signal, task.issueKey));
        if ("exitCode" in result) return result;
        if (read?.kind === "blocked") return fail(`${label} reported blocked: ${read.reason}`);
        if (read?.kind === "none") return fail(`${label} reported no result: ${read.detail}`);
        // The turn is done and its commits are on the branch, so the pause comes after it and before the next turn.
        if (result.warning !== undefined) {
          flushDenials();
          return pauseForQuotaApproval(store, task, io, "executing", result.warning);
        }
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
