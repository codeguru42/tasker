import { CommanderError } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
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
      "Merge a task in accepted on the base branch of origin with one fast-forward push, or merge its recorded PR in in_peer_review after the forge confirms the merge. tasker does not wait for CI",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      await mergeIssue(io, config, issue, { repo: options.repo });
    });
};

// The steps and the output of tasker merge. tasker retry and tasker resume run them too.
export async function mergeIssue(io: Io, config: Config, issue: string, options: { repo?: string }): Promise<void> {
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
  if ("prNumber" in result) {
    io.stdout(`landed PR #${result.prNumber} through ${result.forge}\n`);
    io.stdout("state: landed\n");
    return;
  }
  io.stdout(
    result.pushed
      ? `landed: ${result.revision} on origin/${result.base}\n`
      : `already on origin/${result.base}: ${result.revision}. Nothing pushed.\n`,
  );
}
