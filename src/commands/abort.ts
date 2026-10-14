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
    .description("Remove the worktree and the task branch of an active task, and move the task to cancelled")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option("--force", "Discard the uncommitted changes of the worktree before the abort")
    .action(async (issue: string, options: { repo?: string; force?: boolean }) => {
      const config = loadConfigOrFail(io);
      await orFailAsync(io, async () => {
        const task = await withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
          abortTask(store, {
            config,
            ref,
            taskId: found.id,
            force: options.force === true,
            env: process.env,
            repoLockWaitMs: REPO_LOCK_WAIT_MS,
            report: (line) => io.stdout(`${line}\n`),
          }),
        );
        io.stdout(`cancelled ${task.issueKey}\n`);
      });
    });
};
