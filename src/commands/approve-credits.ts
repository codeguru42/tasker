import type { RegisterCommand } from "../cli.js";
import { approveCreditsTask } from "../tasks/approve-credits.js";
import { resetIsoTime } from "../tasks/run-outcome.js";
import { runResumed } from "./resume.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const approveCredits: RegisterCommand = (program, io) => {
  program
    .command("approve-credits")
    .description(
      "Continue a task in awaiting_quota_approval, or in quota_blocked at the overage boundary, approve paid usage in its quota window, and run the same command again",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      // The move ends here and the store is closed, so the lock is free when the next command takes it.
      const { approvedResetsAt, ...moved } = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, async (store, found, ref) => ({
          key: found.issueKey,
          ...(await approveCreditsTask(store, { ref, taskId: found.id })),
        })),
      );
      io.stdout(
        approvedResetsAt === undefined
          ? `approved credits for ${moved.key}: the pause named no window, so the next warning pauses again\n`
          : `approved credits for ${moved.key}: the quota window that resets at ${resetIsoTime(approvedResetsAt)}\n`,
      );
      await runResumed(io, config, issue, { repo: options.repo }, moved);
    });
};
