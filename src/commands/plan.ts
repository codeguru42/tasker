import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { planTask } from "../tasks/plan.js";
import { runPlanCommand } from "./plan-revision.js";
import { ISSUE_ARGUMENT_DESCRIPTION, loadConfigOrFail, REPO_OPTION_DESCRIPTION } from "./shared.js";

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
      await planIssue(io, config, issue, { repo: options.repo });
    });
};

// The steps and the output of tasker plan. tasker retry and tasker resume run them too.
export async function planIssue(io: Io, config: Config, issue: string, options: { repo?: string }): Promise<void> {
  await runPlanCommand(io, config, issue, options, {
    command: "plan",
    verb: "planned",
    run: (store, ref, taskId) => planTask(store, { config, ref, taskId, env: process.env, io }),
  });
}
