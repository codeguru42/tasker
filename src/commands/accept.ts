import type { RegisterCommand } from "../cli.js";
import { acceptTask } from "../tasks/accept.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_LOCK_WAIT_MS,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const accept: RegisterCommand = (program, io) => {
  program
    .command("accept")
    .description(
      "Accept the work of a task in awaiting_work_review: tasker fetches origin, the branch must contain the tip of the base, and the task goes to accepted",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const accepted = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
          acceptTask(store, { config, ref, taskId: found.id, env: process.env, repoLockWaitMs: REPO_LOCK_WAIT_MS }),
        ),
      );
      io.stdout(`accepted ${accepted.issueKey} at ${accepted.revision}\n`);
    });
};
