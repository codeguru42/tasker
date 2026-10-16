import type { RegisterCommand } from "../cli.js";
import { refineTask } from "../tasks/refine.js";
import { runPlanCommand } from "./plan-revision.js";
import { ISSUE_ARGUMENT_DESCRIPTION, loadConfigOrFail, REPO_OPTION_DESCRIPTION } from "./shared.js";

export const refine: RegisterCommand = (program, io) => {
  program
    .command("refine")
    .description(
      "Continue the plan session of a task in awaiting_plan_review with your feedback, or of a task in reviewed with the open findings of its latest review, and record the next plan revision: the task goes through refining to awaiting_plan_review",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .argument(
      "[feedback]",
      "The feedback on the newest plan revision, required in awaiting_plan_review. In reviewed it is optional and is your guidance on the open findings. The new revision is a complete plan, and a question that it leaves out counts as answered by this feedback",
    )
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, feedback: string | undefined, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      await runPlanCommand(io, config, issue, options, {
        command: "refine",
        verb: "refined",
        run: (store, ref, taskId) => refineTask(store, { config, ref, taskId, feedback, env: process.env, io }),
      });
    });
};
