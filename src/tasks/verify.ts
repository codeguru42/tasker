import type { Io } from "../cli.js";
import { errorMessage } from "../error-message.js";
import type { Config } from "../config/schema.js";
import type { IssueRef } from "../issue-key/ref.js";
import {
  commandFailureMessage,
  commandLogHasNoOutput,
  commandLogTail,
  NO_OUTPUT_LINE,
} from "../phases/command-step.js";
import { runVerify, startedCommands } from "../phases/verify.js";
import { childEnv } from "../process/child-env.js";
import { type TaskState, transitionTask, transitionWithVerifyRun } from "../state/machine.js";
import { verifyCommandLogPath, verifyRunDir } from "../store/layout.js";
import { withTaskLock } from "../store/locks.js";
import type { NewVerifyRun, TaskStore } from "../store/store.js";
import { type UncommittedChange, uncommittedChangeText, vcsForRepo } from "../vcs/provider.js";
import { failRun } from "./run-outcome.js";
import { taskInState } from "./task-state.js";

export interface VerifyRequest {
  config: Config;
  ref: IssueRef;
  // The task that the lookup found. The verify run reads it again under the task lock.
  taskId: number;
  env: NodeJS.ProcessEnv;
  io: Io;
}

export interface VerifiedRun {
  number: number;
  commands: number;
  logsDir: string;
}

// A result with exitCode means that the step already printed the message.
export type VerifyTaskResult = VerifiedRun | { exitCode: number };

// Runs the verify commands of the repo in the worktree of a task in executed. The task lock covers all the steps.
// It does not wait.
export async function verifyTask(store: TaskStore, request: VerifyRequest): Promise<VerifyTaskResult> {
  return withTaskLock(store, request.ref.repoKey, request.ref.key, () => verifyLocked(store, request));
}

// What the outcome step found. A fail outcome records no verify run. A record outcome does.
type VerifyOutcome =
  | { kind: "fail"; message: string }
  | { kind: "record"; run: Omit<NewVerifyRun, "endedAt">; to: TaskState; message?: string };

async function verifyLocked(store: TaskStore, request: VerifyRequest): Promise<VerifyTaskResult> {
  const { config, env, io } = request;
  const task = taskInState(store, request.taskId, "executed", "verify");
  if (task.worktreePath === null) throw new Error(`the task of ${task.issueKey} has no worktree`);
  const worktreePath = task.worktreePath;
  const repo = config.repos[task.repoKey];
  const number = store.nextVerifyRun(task.id);
  const startedAt = new Date().toISOString();
  const logsDir = verifyRunDir(config.dataRoot, task, number);
  const commands = repo.verify.commands;
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  transitionTask(store, task.id, "verifying");

  // The outcome step reads and runs. It writes nothing to the store, except the pid of the command in the marker.
  const outcomeStep = async (): Promise<VerifyOutcome> => {
    const resumeHint = `tasker retry ${task.issueKey} --resume-execute`;
    const dirty = (changes: UncommittedChange[]) => changes.map(uncommittedChangeText).join(", ");
    let before: UncommittedChange[];
    try {
      before = await vcs.uncommittedChanges(ctx, { path: worktreePath });
    } catch (error) {
      const reason = errorMessage(error);
      return { kind: "fail", message: `cannot read the uncommitted changes of the worktree before the run: ${reason}` };
    }
    if (before.length > 0) {
      return {
        kind: "record",
        run: { number, result: "dirty_before", commands: [], failingCommand: null, startedAt },
        to: "failed",
        message:
          `the worktree had uncommitted changes before the verify run: ${dirty(before)}\n` +
          `If the execute run left them, run ${resumeHint}, so that the execute run finishes them.`,
      };
    }
    const result = await runVerify({
      commands,
      env: childEnv(env, repo.verify.env),
      cwd: worktreePath,
      timeoutMs: config.limits.verifyTimeoutMin * 60_000,
      logPath: (position) => verifyCommandLogPath(config.dataRoot, task, number, position),
      onSpawn: (pid) => store.setRunChildPid(task.id, pid),
    });
    if (result.status !== "ok") {
      const log = verifyCommandLogPath(config.dataRoot, task, number, result.index);
      const text =
        `${commandFailureMessage("verify", result, log, config.limits.verifyTimeoutMin)}\n` +
        commandLogTail(log, 20) +
        (commandLogHasNoOutput(log) ? `${NO_OUTPUT_LINE}\n` : "");
      return {
        kind: "record",
        run: {
          number,
          result: result.timedOut ? "timed_out" : "failed",
          commands: startedCommands(commands, result),
          failingCommand: result.index,
          startedAt,
        },
        to: "failed",
        message: text.trimEnd(),
      };
    }
    const allCommands = [...commands];
    let after: UncommittedChange[];
    try {
      after = await vcs.uncommittedChanges(ctx, { path: worktreePath });
    } catch (error) {
      return {
        kind: "record",
        run: { number, result: "failed", commands: allCommands, failingCommand: null, startedAt },
        to: "failed",
        message: `cannot read the uncommitted changes of the worktree after the run: ${errorMessage(error)}`,
      };
    }
    if (after.length > 0) {
      return {
        kind: "record",
        run: { number, result: "dirty_after", commands: allCommands, failingCommand: null, startedAt },
        to: "failed",
        message:
          `the verify commands left uncommitted changes in the worktree: ${dirty(after)}\n` +
          `A plain tasker retry runs the commands on the same tree and fails again. ` +
          `Run ${resumeHint}, so that the fix turn ignores or removes these files.`,
      };
    }
    return {
      kind: "record",
      run: { number, result: "passed", commands: allCommands, failingCommand: null, startedAt },
      to: "awaiting_work_review",
    };
  };

  let outcome: VerifyOutcome;
  try {
    outcome = await outcomeStep();
  } catch (error) {
    outcome = { kind: "fail", message: `verifying failed: ${errorMessage(error)}` };
  }
  if (outcome.kind === "fail") return failRun(store, task, io, outcome.message);

  const failed = outcome.to === "failed";
  try {
    transitionWithVerifyRun(
      store,
      task.id,
      outcome.to,
      { ...outcome.run, endedAt: new Date().toISOString() },
      failed ? { error: outcome.message } : undefined,
    );
  } catch (error) {
    const reason = errorMessage(error);
    return failRun(
      store,
      task,
      io,
      failed ? `verifying failed: ${reason}` : `the verify commands passed, but the run could not be recorded: ${reason}`,
    );
  }
  if (failed) {
    io.stderr(`${outcome.message}\n`);
    return { exitCode: 1 };
  }
  return { number, commands: commands.length, logsDir };
}
