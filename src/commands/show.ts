import type { RegisterCommand } from "../cli.js";
import { showLines } from "../state/commands.js";
import { formatFindings } from "../review/findings-text.js";
import { transitionFromEvents, lastTransitionError } from "../state/machine.js";
import type { ExecuteTodoProgress, Task, TaskStore } from "../store/store.js";
import {
  formatColumns,
  formatFields,
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  oneLine,
  REPO_OPTION_DESCRIPTION,
  withIssueTask,
} from "./shared.js";

const TODO_STATE_LABELS: Record<ExecuteTodoProgress["state"], string> = {
  done: "done",
  in_progress: "in progress",
  not_started: "not started",
};

// The todos of the pinned revision with their states, then the state of its fix turn.
// The text is empty when the task has no pinned revision, or when no todo of it has a recorded state.
function todoProgress(store: TaskStore, taskId: number): string {
  const pinned = store.pinnedPlanRevision(taskId);
  if (pinned === undefined) return "";
  const progress = store.executeTodoProgress(taskId, pinned.version);
  if (progress.every(({ state }) => state === "not_started")) return "";
  const rows = progress.map(({ todo, state }) => [TODO_STATE_LABELS[state], todo.id, oneLine(todo.title)]);
  const lines = formatColumns(rows).map((line) => `  ${line}\n`);
  const fixTurn = store.executeFixTurnState(taskId, pinned.version);
  const fixTurnLine = fixTurn === undefined ? "" : `fix turn: ${fixTurn}\n`;
  return `todos (approved v${pinned.version}):\n${lines.join("")}${fixTurnLine}`;
}

// The findings of the latest review, for a task in reviewed. The text is empty in each other state.
function reviewFindings(store: TaskStore, task: Task): string {
  if (task.state !== "reviewed") return "";
  const review = store.latestReview(task.id);
  if (review === undefined) return "";
  return `review findings (review ${review.number}, at ${review.revision}):\n${formatFindings(review.findings)}`;
}

function formatTask(store: TaskStore, task: Task): string {
  const events = store.listEvents(task.id);
  const last = events.at(-1);
  const fields: [string, string | number | null | undefined][] = [
    ["issue", task.issueKey],
    ["repo", task.repoKey],
    ["title", task.title],
    ["state", task.state],
    ["attempt", task.attempt],
    ["base", task.base],
    ["branch", task.branch],
    ["worktree", task.worktreePath],
    ["created", task.createdAt],
    ["updated", task.updatedAt],
    ["last event", last && `${last.at} ${last.type} ${JSON.stringify(last.data)}`],
  ];
  if (task.state === "failed") {
    fields.push(["failed in", transitionFromEvents(events, "failed")], ["error", lastTransitionError(events)]);
  }
  const commandLines = showLines(task.state, task.issueKey)
    .map((line) => `${line}\n`)
    .join("");
  return formatFields(fields) + commandLines + todoProgress(store, task.id) + reviewFindings(store, task);
}

export const show: RegisterCommand = (program, io) => {
  program
    .command("show")
    .description("Print the details of the task of an issue: the active task, else the newest one")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      io.stdout(await withIssueTask(io, config, issue, { repo: options.repo }, formatTask));
    });
};
