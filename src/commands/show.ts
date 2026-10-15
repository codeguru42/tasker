import type { RegisterCommand } from "../cli.js";
import { failedFrom } from "../state/machine.js";
import type { ExecuteTodoProgress, Task, TaskEvent, TaskStore } from "../store/store.js";
import {
  formatFields,
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  oneLine,
  REPO_OPTION_DESCRIPTION,
  withIssueTask,
} from "./shared.js";

// The error of the last transition event, when it is a string.
function lastError(events: TaskEvent[]): string | undefined {
  const transition = events.filter((event) => event.type === "transition").at(-1);
  const data = transition?.data;
  if (typeof data !== "object" || data === null || !("error" in data)) return undefined;
  return typeof data.error === "string" ? data.error : undefined;
}

const TODO_STATE_LABELS: Record<ExecuteTodoProgress["state"], string> = {
  done: "done",
  in_progress: "in progress",
  not_started: "not started",
};

// The todos of the pinned revision with their states.
// The text is empty when the task has no pinned revision, or when no todo of it has a recorded state.
function todoProgress(store: TaskStore, taskId: number): string {
  const pinned = store.pinnedPlanRevision(taskId);
  if (pinned === undefined) return "";
  const progress = store.executeTodoProgress(taskId, pinned.version);
  if (progress.every(({ state }) => state === "not_started")) return "";
  const labels = progress.map(({ state }) => TODO_STATE_LABELS[state]);
  const stateWidth = Math.max(...labels.map((label) => label.length));
  const idWidth = Math.max(...progress.map(({ todo }) => todo.id.length));
  const lines = progress.map(
    ({ todo }, i) => `  ${labels[i].padEnd(stateWidth)}  ${todo.id.padEnd(idWidth)}  ${oneLine(todo.title)}\n`,
  );
  return `todos (approved v${pinned.version}):\n${lines.join("")}`;
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
    fields.push(["failed in", failedFrom(store, task.id)], ["error", lastError(events)]);
  }
  return formatFields(fields) + todoProgress(store, task.id);
}

export const show: RegisterCommand = (program, io) => {
  program
    .command("show")
    .description("Print the details of the task of an issue: the active task, else the newest one")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action((issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      io.stdout(withIssueTask(io, config, issue, { repo: options.repo }, formatTask));
    });
};
