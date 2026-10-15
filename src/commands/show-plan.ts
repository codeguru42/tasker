import { readFileSync } from "node:fs";
import type { Io, RegisterCommand } from "../cli.js";
import { errnoCode } from "../errno.js";
import { planRevisionPath } from "../store/layout.js";
import type { PlanRevision, Task, TaskStore } from "../store/store.js";
import {
  formatQuestions,
  indented,
  planHeader,
  planRevisionOrFail,
  planVersionOrFail,
  VERSION_OPTION_DESCRIPTION,
} from "./plan-revision.js";
import { fail, ISSUE_ARGUMENT_DESCRIPTION, loadConfigOrFail, REPO_OPTION_DESCRIPTION, withIssueTask } from "./shared.js";

// The text of the plan file. A read error stops the command with exit code 1.
function readPlanFile(io: Io, path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT") fail(io, `no plan file at ${path}`);
    fail(io, `cannot read the plan file ${path}: ${code}`);
  }
}

function approvalLine(store: TaskStore, task: Task, revision: PlanRevision): string {
  const pinned = store.pinnedPlanRevision(task.id);
  if (pinned === undefined) return "not approved";
  if (pinned.version === revision.version) return "approved";
  return `approved revision is v${pinned.version}`;
}

function formatTodos(revision: PlanRevision): string {
  const todos = revision.answer.todos.map((todo) => {
    const dependsOn = todo.depends_on.length === 0 ? "none" : todo.depends_on.join(", ");
    return (
      `${indented("  ", `${todo.id}: ${todo.title}`)}\n` +
      `${indented("    ", todo.description)}\n` +
      `    depends on: ${dependsOn}\n`
    );
  });
  return `todos:\n${todos.join("")}`;
}

function formatPlan(store: TaskStore, task: Task, revision: PlanRevision, planText: string): string {
  const lineEnd = /[\r\n]$/.test(planText) ? "" : "\n";
  return (
    `${planHeader(task, revision)}\n${approvalLine(store, task, revision)}\n\n` +
    `${planText}${lineEnd}${formatTodos(revision)}${formatQuestions(store.planQuestions(task.id, revision.version))}`
  );
}

export const showPlan: RegisterCommand = (program, io) => {
  program
    .command("show-plan")
    .description("Print one plan revision of the task of an issue: the plan, the todos and the questions")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option("--version <N>", VERSION_OPTION_DESCRIPTION)
    .option("--path", "Print only the path of the plan file of the revision")
    .action((issue: string, options: { repo?: string; version?: string; path?: boolean }) => {
      const version = planVersionOrFail(io, options.version);
      const config = loadConfigOrFail(io);
      io.stdout(
        withIssueTask(io, config, issue, { repo: options.repo }, (store, task) => {
          const revision = planRevisionOrFail(io, store, task, version);
          const path = planRevisionPath(config.dataRoot, task, revision.version);
          if (options.path) return `${path}\n`;
          return formatPlan(store, task, revision, readPlanFile(io, path));
        }),
      );
    });
};
