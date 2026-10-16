import type { RegisterCommand } from "../cli.js";
import { markLandedTask } from "../tasks/mark-landed.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_LOCK_WAIT_MS,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const markLanded: RegisterCommand = (program, io) => {
  program
    .command("mark-landed")
    .description(
      "Record that the work of a task in accepted, pushed or in_peer_review already landed on the base branch outside tasker: tasker fetches origin, the base must contain the task branch, and the task goes to landed. tasker never pushes",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const marked = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
          markLandedTask(store, { config, ref, taskId: found.id, env: process.env, repoLockWaitMs: REPO_LOCK_WAIT_MS }),
        ),
      );
      io.stdout(`marked ${marked.issueKey} landed at ${marked.revision}\n`);
    });
};
