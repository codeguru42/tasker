import { CommanderError } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { openPrTask } from "../tasks/open-pr.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_LOCK_WAIT_MS,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const openPr: RegisterCommand = (program, io) => {
  program
    .command("open-pr")
    .description("Open or adopt a pull request against the stored base of a published task")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option(
      "--draft",
      "Create the pull request as a draft. Without this option, the key repos.<key>.forge.draftPr decides.",
    )
    .action(async (issue: string, options: { repo?: string; draft?: boolean }) => {
      const config = loadConfigOrFail(io);
      await openPrIssue(io, config, issue, { repo: options.repo, draft: options.draft });
    });
};

// The steps and output of tasker open-pr. Recovery calls this same runner after its lock is free.
export async function openPrIssue(
  io: Io,
  config: Config,
  issue: string,
  options: { repo?: string; draft?: boolean },
): Promise<void> {
  const result = await orFailAsync(io, () =>
    withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
      openPrTask(store, {
        config,
        ref,
        taskId: found.id,
        env: process.env,
        io,
        repoLockWaitMs: REPO_LOCK_WAIT_MS,
        draft: options.draft,
      }),
    ),
  );
  if ("exitCode" in result)
    throw new CommanderError(result.exitCode, "tasker.open-pr", "opening the PR did not succeed");
  io.stdout(`${result.adopted ? "adopted" : "opened"} PR #${result.pullRequest.number}: ${result.pullRequest.url}\n`);
  io.stdout("state: in_peer_review\n");
}
