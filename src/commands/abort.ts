import type { RegisterCommand } from "../cli.js";
import { abortTask } from "../tasks/abort.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_LOCK_WAIT_MS,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const abort: RegisterCommand = (program, io) => {
  program
    .command("abort")
    .description("Cancel an active task and remove its worktree and published task branch.")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option("--force", "Discard the uncommitted changes of the worktree before the abort")
    .option("--keep-remote", "Keep the task branch on origin during the abort.")
    .action(async (issue: string, options: { repo?: string; force?: boolean; keepRemote?: boolean }) => {
      const config = loadConfigOrFail(io);
      await orFailAsync(io, async () => {
        const task = await withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
          abortTask(store, {
            config,
            ref,
            taskId: found.id,
            force: options.force === true,
            keepRemote: options.keepRemote === true,
            env: process.env,
            repoLockWaitMs: REPO_LOCK_WAIT_MS,
            report: (line) => io.stdout(`${line}\n`),
            trackerIo: { stdout: io.stdout, stderr: io.stderr },
          }),
        );
        io.stdout(`cancelled ${task.issueKey}\n`);
      });
    });
};
