import { CommanderError } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { findingCountText, formatFindings } from "../review/findings-text.js";
import { reviewFeedbackTask } from "../tasks/review-feedback.js";
import { reviewTask } from "../tasks/review.js";
import { runPlanCommand } from "./plan-revision.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const review: RegisterCommand = (program, io) => {
  program
    .command("review")
    .description(
      "Review the committed work of a task in awaiting_work_review in a new session of the assistant, and record the findings: the task goes through reviewing to reviewed, or back to awaiting_work_review when the review has no findings. With your feedback, continue the plan session instead and record the next plan revision: the task goes through refining to awaiting_plan_review",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .argument(
      "[feedback]",
      "Your feedback on the committed work, quoted as one argument. With it, the command continues the plan session of the task and records the next plan revision: the task goes through refining to awaiting_plan_review. Without it, the command runs the automated review",
    )
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, feedback: string | undefined, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      if (feedback !== undefined) {
        await runPlanCommand(io, config, issue, options, {
          command: "review",
          verb: "refined",
          run: (store, ref, taskId) =>
            reviewFeedbackTask(store, { config, ref, taskId, feedback, env: process.env, io }),
        });
        return;
      }
      await reviewIssue(io, config, issue, { repo: options.repo });
    });
};

// The steps and the output of the automated review of tasker review. tasker retry runs them too.
export async function reviewIssue(io: Io, config: Config, issue: string, options: { repo?: string }): Promise<void> {
  const result = await orFailAsync(io, () =>
    withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
      reviewTask(store, { config, ref, taskId: found.id, env: process.env, io }),
    ),
  );
  if ("exitCode" in result) {
    throw new CommanderError(result.exitCode, "tasker.review", "the review run did not succeed");
  }
  io.stdout(
    [
      `reviewed ${result.issueKey}: review ${result.number}, ${findingCountText(result.findings.length)}`,
      `${formatFindings(result.findings)}prompt: ${result.promptPath}`,
      `transcript: ${result.transcriptPath}`,
      "",
    ].join("\n"),
  );
}
