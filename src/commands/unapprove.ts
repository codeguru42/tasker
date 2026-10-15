import type { RegisterCommand } from "../cli.js";
import { unapproveTask } from "../tasks/unapprove.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const unapprove: RegisterCommand = (program, io) => {
  program
    .command("unapprove")
    .description(
      "Take back the approval of the pinned plan revision of a task in approved, before execute starts: the task goes back to awaiting_plan_review",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const unapproved = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
          unapproveTask(store, { ref, taskId: found.id }),
        ),
      );
      io.stdout(`unapproved ${unapproved.issueKey}: revision v${unapproved.version} is no longer pinned\n`);
    });
};
