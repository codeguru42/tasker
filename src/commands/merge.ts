import { CommanderError } from "commander";
import type { RegisterCommand } from "../cli.js";
import { mergeTask } from "../tasks/merge.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_LOCK_WAIT_MS,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const merge: RegisterCommand = (program, io) => {
  program
    .command("merge")
    .description(
      "Land the work of a task in accepted on the base branch of origin with one fast-forward push: the task goes through merging to landed, or to failed. tasker does not wait for CI",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const result = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
          mergeTask(store, {
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
        throw new CommanderError(result.exitCode, "tasker.merge", "the merge did not succeed");
      }
      io.stdout(`merged ${result.issueKey}\n`);
      io.stdout(
        result.pushed
          ? `landed: ${result.revision} on origin/${result.base}\n`
          : `already on origin/${result.base}: ${result.revision}. Nothing pushed.\n`,
      );
    });
};
