import type { RegisterCommand } from "../cli.js";
import { indented } from "../indented.js";
import { planRevisionPath } from "../store/layout.js";
import type { PlanRevision, Task, TaskStore } from "../store/store.js";
import { formatQuestions, planHeader, planRevisionOrFail, VERSION_OPTION_DESCRIPTION } from "./plan-revision.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  readFileOrFail,
  REPO_OPTION_DESCRIPTION,
  wholeNumberOptionsOrFail,
  withFinalLineEnd,
  withIssueTask,
} from "./shared.js";

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
  return (
    `${planHeader(task, revision)}\n${approvalLine(store, task, revision)}\n\n` +
    `${withFinalLineEnd(planText)}${formatTodos(revision)}${formatQuestions(store.planQuestions(task.id, revision.version))}`
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
    .action(async (issue: string, options: { repo?: string; version?: string; path?: boolean }) => {
      wholeNumberOptionsOrFail(io, { "--version": options.version });
      const config = loadConfigOrFail(io);
      io.stdout(
        await withIssueTask(io, config, issue, { repo: options.repo }, (store, task) => {
          const revision = planRevisionOrFail(io, store, task, options.version);
          const path = planRevisionPath(config.dataRoot, task, revision.version);
          if (options.path) return `${path}\n`;
          const planText = readFileOrFail(io, path, {
            missing: `no plan file at ${path}`,
            unreadable: `cannot read the plan file ${path}`,
          });
          return formatPlan(store, task, revision, planText);
        }),
      );
    });
};
