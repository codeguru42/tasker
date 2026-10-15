import type { Io } from "../cli.js";
import type { PlanQuestionState, PlanRevision, Task, TaskStore } from "../store/store.js";
import { fail } from "./shared.js";

export const VERSION_OPTION_DESCRIPTION =
  "Use this plan revision: a whole number of 1 or more. The default is the newest revision";

// The value of --version, or undefined when the option is absent. A bad value stops the command with exit code 1.
// The raw string stays, so that a very large number prints as the user typed it.
export function planVersionOrFail(io: Io, raw: string | undefined): string | undefined {
  if (raw !== undefined && !/^[1-9][0-9]*$/.test(raw)) {
    fail(io, `--version must be a whole number of 1 or more: ${raw}`);
  }
  return raw;
}

// The revision of the task: the newest one, or the one of version.
export function planRevisionOrFail(io: Io, store: TaskStore, task: Task, version: string | undefined): PlanRevision {
  const latest = store.latestPlanRevision(task.id);
  if (latest === undefined) fail(io, `the task of ${task.issueKey} has no plan revision; run tasker plan first`);
  if (version === undefined) return latest;
  return store.getPlanRevision(task.id, Number(version)) ?? fail(io, `the task of ${task.issueKey} has no plan revision v${version}`);
}

// The first line of the plan commands, with no line end.
export function planHeader(task: Task, revision: PlanRevision): string {
  return `${task.issueKey} plan v${revision.version}`;
}

// The text with the prefix before each of its lines. Each line end of the text counts.
export function indented(prefix: string, text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
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
