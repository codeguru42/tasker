import type { RegisterCommand } from "../cli.js";
import { failedFrom } from "../state/machine.js";
import type { Task, TaskEvent, TaskStore } from "../store/store.js";
import { formatFields, loadConfigOrFail, withIssueTask } from "./shared.js";

// The error of the last transition event, when it is a string.
function lastError(events: TaskEvent[]): string | undefined {
  const transition = events.filter((event) => event.type === "transition").at(-1);
  const data = transition?.data;
  if (typeof data !== "object" || data === null || !("error" in data)) return undefined;
  return typeof data.error === "string" ? data.error : undefined;
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
  return formatFields(fields);
}

export const show: RegisterCommand = (program, io) => {
  program
    .command("show")
    .description("Print the details of the task of an issue: the active task, else the newest one")
    .argument("<issue>", "The issue key of the task")
    .option("--repo <key>", "Use the repo with this key when two repos share the project of the issue")
    .action((issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      io.stdout(withIssueTask(io, config, issue, { repo: options.repo }, formatTask));
    });
};
