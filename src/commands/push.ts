import { CommanderError } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { pushTask } from "../tasks/push.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_LOCK_WAIT_MS,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const push: RegisterCommand = (program, io) => {
  program
    .command("push")
    .description("Publish the accepted task branch to origin")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      await pushIssue(io, config, issue, { repo: options.repo });
    });
};

// The steps and output of tasker push. tasker retry and tasker resume run them too.
export async function pushIssue(io: Io, config: Config, issue: string, options: { repo?: string }): Promise<void> {
  const result = await orFailAsync(io, () =>
    withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
      pushTask(store, {
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
    throw new CommanderError(result.exitCode, "tasker.push", "the push did not succeed");
  }
  io.stdout(`pushed ${result.issueKey}\n`);
  io.stdout(
    result.pushed
      ? `published: ${result.revision} to origin/${result.branch}\n`
      : `already published: ${result.revision} on origin/${result.branch}. Nothing pushed.\n`,
  );
}
