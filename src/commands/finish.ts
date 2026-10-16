import { CommanderError } from "commander";
import type { RegisterCommand } from "../cli.js";
import { finishTask } from "../tasks/finish.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_LOCK_WAIT_MS,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const finish: RegisterCommand = (program, io) => {
  program
    .command("finish")
    .description(
      "Clean up a task in landed or cleanup_failed: remove the worktree and the local task branch. The task goes through finishing to finished, or to cleanup_failed when a step fails. A second run finishes the steps that are left",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const result = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
          finishTask(store, {
            config,
            ref,
            taskId: found.id,
            env: process.env,
            io,
            repoLockWaitMs: REPO_LOCK_WAIT_MS,
          }),
        ),
      );
      if ("exitCode" in result) {
        throw new CommanderError(result.exitCode, "tasker.finish", "the finish did not succeed");
      }
      io.stdout(`finished ${result.issueKey}\n`);
    });
};
