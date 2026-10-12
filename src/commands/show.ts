import type { RegisterCommand } from "../cli.js";
import type { Task, TaskStore } from "../store/store.js";
import { loadConfigOrFail, withIssueTask } from "./shared.js";

// The text of a field value, or - when the field has no value.
function fieldValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "-" : String(value);
}

function formatTask(store: TaskStore, task: Task): string {
  const last = store.listEvents(task.id).at(-1);
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
  return fields.map(([field, value]) => `${field}: ${fieldValue(value)}\n`).join("");
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
