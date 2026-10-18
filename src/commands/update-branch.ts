import { CommanderError } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { updateBranchTask } from "../tasks/update-branch.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_LOCK_WAIT_MS,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const updateBranch: RegisterCommand = (program, io) => {
  program
    .command("update-branch")
    .description(
      "Bring the task branch current with its copy on origin, and bring the worktree of the task up to date with its base branch. The command does the first step first. Without --take-remote, it moves the branch only by a fast-forward, and tips that have diverged are an error. The task goes through updating_branch. When the head moved, the task goes back to executed, or to awaiting_plan_review for an approved plan, because the old approval or verify result no longer describes the tree. A task stacked on the branch of a parent task moves onto the tip of that branch: the command replays the commits of the task after the merge base with a rebase",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option(
      "--strategy <value>",
      "How to bring the branch up to date: rebase or merge. The option overrides updateBranchStrategy of the repo for one run. It does not apply to a stacked task",
    )
    .option(
      "--take-remote",
      "Move the task branch and the worktree to origin/<task branch> when the tips differ. The option discards the local commits that origin does not hold",
    )
    .action(async (issue: string, options: { repo?: string; strategy?: string; takeRemote?: boolean }) => {
      const config = loadConfigOrFail(io);
      await updateBranchIssue(io, config, issue, options);
    });
};

async function updateBranchIssue(
  io: Io,
  config: Config,
  issue: string,
  options: { repo?: string; strategy?: string; takeRemote?: boolean },
): Promise<void> {
  const result = await orFailAsync(io, () =>
    withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
      updateBranchTask(store, {
        config,
        ref,
        taskId: found.id,
        strategy: options.strategy,
        takeRemote: options.takeRemote === true,
        env: process.env,
        io,
        repoLockWaitMs: REPO_LOCK_WAIT_MS,
      }),
    ),
  );
  if ("exitCode" in result) {
    throw new CommanderError(result.exitCode, "tasker.update-branch", "the update did not succeed");
  }
  if ("remoteTip" in result) {
    io.stdout(`synced ${result.branch} from origin/${result.branch} at ${result.remoteTip} by ${result.sync}\n`);
  }
  if (result.how === "none") {
    io.stdout(`${result.issueKey} is current with ${result.base} at ${result.baseTip}; nothing moved\n`);
  } else {
    io.stdout(
      `moved ${result.issueKey} onto ${result.base} at ${result.baseTip} by ${result.how}: ${result.headBefore} to ${result.headAfter}\n`,
    );
  }
  if (result.state !== result.origin) {
    io.stdout(`demoted ${result.issueKey} from ${result.origin} to ${result.state}\n`);
  }
  io.stdout(`state: ${result.state}\n`);
}
