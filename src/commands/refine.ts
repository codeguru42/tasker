import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { refineTask } from "../tasks/refine.js";
import { runPlanCommand } from "./plan-revision.js";
import { ISSUE_ARGUMENT_DESCRIPTION, loadConfigOrFail, REPO_OPTION_DESCRIPTION } from "./shared.js";

export const refine: RegisterCommand = (program, io) => {
  program
    .command("refine")
    .description(
      "Continue the plan session of a task in awaiting_plan_review with your feedback, of a task in reviewed with the open findings of its latest review, or of a task in failed with the error of the failure and your instruction for the fix, and record the next plan revision: the task goes through refining to awaiting_plan_review",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .argument(
      "[feedback]",
      "The feedback on the newest plan revision, required in awaiting_plan_review and in failed. In failed it is your instruction for the fix. In reviewed it is optional and is your guidance on the open findings. The new revision is a complete plan, and a question that it leaves out counts as answered by this feedback",
    )
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, feedback: string | undefined, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      await refineIssue(io, config, issue, options, feedback);
    });
};

// The steps and the output of tasker refine. tasker resume runs them too.
export async function refineIssue(
  io: Io,
  config: Config,
  issue: string,
  options: { repo?: string },
  feedback: string | undefined,
): Promise<void> {
  await runPlanCommand(io, config, issue, options, {
    command: "refine",
    verb: "refined",
    run: (store, ref, taskId) => refineTask(store, { config, ref, taskId, feedback, env: process.env, io }),
  });
}
