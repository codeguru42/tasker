import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { planTask } from "../tasks/plan.js";
import { reportPlanRun } from "./plan-revision.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
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
      await planIssue(io, config, issue, { repo: options.repo });
    });
};

// The steps and the output of tasker plan. tasker retry runs them too.
export async function planIssue(
  io: Io,
  config: Config,
  issue: string,
  options: { repo?: string },
): Promise<void> {
  const result = await orFailAsync(io, () =>
    withIssueTaskAsync(io, config, issue, { repo: options.repo }, async (store, found, ref) => ({
      key: found.issueKey,
      taskId: found.id,
      planned: await planTask(store, { config, ref, taskId: found.id, env: process.env, io }),
    })),
  );
  const { key, taskId, planned } = result;
  await reportPlanRun(io, config, {
    command: "plan",
    taskId,
    result: planned,
    firstLine: (version) => `planned ${key} as revision v${version}`,
  });
}
