import { CommanderError } from "commander";
import type { Io } from "../cli.js";
import type { Config } from "../config/schema.js";
import { indented } from "../indented.js";
import type { PlanResult } from "../tasks/plan-run.js";
import type { PlanQuestionState, PlanRevision, Task, TaskStore } from "../store/store.js";
import type { IssueRef } from "../issue-key/ref.js";
import { fail, orFailAsync, warnOverlaps, withIssueTaskAsync } from "./shared.js";

export const VERSION_OPTION_DESCRIPTION =
  "Use this plan revision: a whole number of 1 or more. The default is the newest revision";

// The revision of the task: the newest one, or the one of version.
export function planRevisionOrFail(io: Io, store: TaskStore, task: Task, version: string | undefined): PlanRevision {
  const latest = store.latestPlanRevision(task.id);
  if (latest === undefined) fail(io, `the task of ${task.issueKey} has no plan revision; run tasker plan first`);
  if (version === undefined) return latest;
  return (
    store.getPlanRevision(task.id, Number(version)) ??
    fail(io, `the task of ${task.issueKey} has no plan revision v${version}`)
  );
}

// The first line of the plan commands, with no line end.
export function planHeader(task: Task, revision: PlanRevision): string {
  return `${task.issueKey} plan v${revision.version}`;
}

function formatQuestionState(state: PlanQuestionState): string {
  if (state.state === "open") return "open";
  if (state.answer === null) return `answered in v${state.version}`;
  return `answered in v${state.version}: ${state.answer}`;
}

// The questions block: "questions:", then each question with its context and state, or "none".
export function formatQuestions(states: PlanQuestionState[]): string {
  if (states.length === 0) return "questions:\n  none\n";
  const items = states.map((entry) => {
    const { id, question, context } = entry.question;
    return (
      `${indented("  ", `${id}: ${question}`)}\n` +
      `${indented("    ", context)}\n` +
      `${indented("    ", formatQuestionState(entry))}\n`
    );
  });
  return `questions:\n${items.join("")}`;
}

// The last lines of the overlap warning after a plan or a refine: the task waits in awaiting_plan_review for the approve.
const PLAN_OVERLAP_LAST_LINES: readonly string[] = ["tasker does not refuse. Decide before you approve."];

// Prints the lines of a new plan revision, with "<verb> <issue key> as revision v<N>" first, then the overlap warning on
// stderr. A result with exitCode stops the command: the run step already printed the message.
async function reportPlanRun(
  io: Io,
  config: Config,
  o: {
    command: "plan" | "refine" | "review";
    taskId: number;
    result: PlanResult;
    verb: "planned" | "refined";
    key: string;
  },
): Promise<void> {
  const { result } = o;
  if ("exitCode" in result) {
    throw new CommanderError(result.exitCode, `tasker.${o.command}`, `the ${o.command} run did not succeed`);
  }
  io.stdout(
    [
      `${o.verb} ${o.key} as revision v${result.version}`,
      `plan: ${result.planPath}`,
      `prompt: ${result.promptPath}`,
      "todos:",
      ...result.answer.todos.map((todo) => `- ${todo.id}: ${todo.title}`),
      `questions: ${result.answer.questions.length}`,
      "",
    ].join("\n"),
  );
  await warnOverlaps(io, config, {
    taskId: o.taskId,
    files: result.answer.files_changed,
    env: process.env,
    lastLines: PLAN_OVERLAP_LAST_LINES,
  });
}

// Finds the task of the issue, runs the step that records a plan revision, and prints its lines.
// tasker plan, tasker refine and the feedback form of tasker review use it.
export async function runPlanCommand(
  io: Io,
  config: Config,
  issue: string,
  options: { repo?: string },
  o: {
    command: "plan" | "refine" | "review";
    verb: "planned" | "refined";
    run: (store: TaskStore, ref: IssueRef, taskId: number) => Promise<PlanResult>;
  },
): Promise<void> {
  const { key, taskId, result } = await orFailAsync(io, () =>
    withIssueTaskAsync(io, config, issue, { repo: options.repo }, async (store, found, ref) => ({
      key: found.issueKey,
      taskId: found.id,
      result: await o.run(store, ref, found.id),
    })),
  );
  await reportPlanRun(io, config, { command: o.command, taskId, result, verb: o.verb, key });
}
