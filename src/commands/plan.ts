import { CommanderError } from "commander";
import type { RegisterCommand } from "../cli.js";
import { planTask } from "../tasks/plan.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  warnOverlaps,
  withIssueTaskAsync,
} from "./shared.js";

export const plan: RegisterCommand = (program, io) => {
  program
    .command("plan")
    .description(
      "Run the assistant in plan mode in the worktree of a task in workspace_ready, and record the first plan revision: the task goes to awaiting_plan_review",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const result = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, async (store, found, ref) => ({
          key: found.issueKey,
          taskId: found.id,
          planned: await planTask(store, { config, ref, taskId: found.id, env: process.env, io }),
        })),
      );
      const { key, taskId, planned } = result;
      // The run step already printed the message.
      if ("exitCode" in planned) {
        throw new CommanderError(planned.exitCode, "tasker.plan", "the plan run did not succeed");
      }
      io.stdout(
        [
          `planned ${key} as revision v${planned.version}`,
          `plan: ${planned.planPath}`,
          `prompt: ${planned.promptPath}`,
          "todos:",
          ...planned.answer.todos.map((todo) => `- ${todo.id}: ${todo.title}`),
          `questions: ${planned.answer.questions.length}`,
          "",
        ].join("\n"),
      );
      await warnOverlaps(io, config, {
        taskId,
        files: planned.answer.files_changed,
        env: process.env,
        lastLine: "tasker does not refuse. Decide before you approve.",
      });
    });
};
