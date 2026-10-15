import type { RegisterCommand } from "../cli.js";
import { refineTask } from "../tasks/refine.js";
import { reportPlanRun } from "./plan-revision.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const refine: RegisterCommand = (program, io) => {
  program
    .command("refine")
    .description(
      "Continue the plan session of a task in awaiting_plan_review with your feedback, and record the next plan revision: the task goes through refining back to awaiting_plan_review",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .argument(
      "<feedback>",
      "The feedback on the newest plan revision. The new revision is a complete plan, and a question that it leaves out counts as answered by this feedback",
    )
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, feedback: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const { key, taskId, refined } = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, async (store, found, ref) => ({
          key: found.issueKey,
          taskId: found.id,
          refined: await refineTask(store, { config, ref, taskId: found.id, feedback, env: process.env, io }),
        })),
      );
      await reportPlanRun(io, config, {
        command: "refine",
        taskId,
        result: refined,
        firstLine: (version) => `refined ${key} as revision v${version}`,
      });
    });
};
