import type { RegisterCommand } from "../cli.js";
import { retryTask } from "../tasks/retry.js";
import { executeIssue } from "./execute.js";
import { planIssue } from "./plan.js";
import { reviewIssue } from "./review.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";
import { startIssue } from "./start.js";
import { verifyIssue } from "./verify.js";

export const retry: RegisterCommand = (program, io) => {
  program
    .command("retry")
    .description("Move a task in failed back to the state before the step that failed, and run that step again")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option(
      "--resume-execute",
      "For a task that failed in verifying: mark every todo done and continue the execute session with one fix turn for the failure, in place of a new verify run",
    )
    .action(async (issue: string, options: { repo?: string; resumeExecute?: boolean }) => {
      const config = loadConfigOrFail(io);
      // The move ends here and the store is closed, so the lock is free when the next command takes it.
      const { key, origin, target, next } = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, async (store, found, ref) => ({
          key: found.issueKey,
          ...(await retryTask(store, {
            config,
            ref,
            taskId: found.id,
            resumeExecute: options.resumeExecute === true,
          })),
        })),
      );
      io.stdout(`retried ${key}: failed in ${origin}, back in ${target}\n`);
      const repo = { repo: options.repo };
      switch (next) {
        case "refine":
          io.stdout(`run tasker refine ${key} "<feedback>" again\n`);
          break;
        case "refine-findings":
          io.stdout(
            `run tasker refine ${key} again to act on the findings, or tasker dismiss-review ${key} "<reason>"\n`,
          );
          break;
        case "review-feedback":
          io.stdout(`run tasker review ${key} "<feedback>" again\n`);
          break;
        case "start":
          await startIssue(io, config, issue, repo);
          break;
        case "plan":
          await planIssue(io, config, issue, repo);
          break;
        case "execute":
          await executeIssue(io, config, issue, repo);
          break;
        case "verify":
          await verifyIssue(io, config, issue, repo);
          break;
        case "review":
          await reviewIssue(io, config, issue, repo);
          break;
      }
    });
};
