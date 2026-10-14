import type { RegisterCommand } from "../cli.js";
import { errorMessage } from "../error-message.js";
import { BootstrapFailedError, startTask } from "../tasks/start.js";
import {
  formatFields,
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  REPO_LOCK_WAIT_MS,
  REPO_OPTION_DESCRIPTION,
  orFailAsync,
  resolveIssueKeyOrFail,
  withStoreAsync,
} from "./shared.js";

export const start: RegisterCommand = (program, io) => {
  program
    .command("start")
    .description(
      "Make a task for an issue and take it to workspace_ready: read the issue, make the clone, resolve the base, make the worktree and run bootstrap",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option(
      "--base <branch>",
      "The base branch of this task only: a branch on origin, or refs/heads/<branch> for a local branch of the clone",
    )
    .action(async (issue: string, options: { repo?: string; base?: string }) => {
      const config = loadConfigOrFail(io);
      const ref = resolveIssueKeyOrFail(io, issue, config, { repo: options.repo });
      const ask = () =>
        io.prompt === undefined
          ? Promise.reject(
              new Error(
                `no base branch for ${ref.repoKey}: pass --base <branch>, or set repos.${ref.repoKey}.defaultBaseBranch`,
              ),
            )
          : io.prompt(`Base branch for ${ref.repoKey}: `);
      const outcome = await orFailAsync(
        io,
        () =>
          withStoreAsync(config, (store) =>
            startTask(store, {
              config,
              ref,
              base: options.base,
              env: process.env,
              repoLockWaitMs: REPO_LOCK_WAIT_MS,
              ask,
              note: (line) => io.stderr(`${line}\n`),
            }),
          ),
        // The bootstrap error comes first, then the tail of the log.
        (error) =>
          error instanceof BootstrapFailedError
            ? `${error.message}\n${error.tail.trimEnd()}`
            : errorMessage(error),
      );
      const { task } = outcome;
      if (!outcome.started) io.stdout("task already started\n");
      io.stdout(
        formatFields([
          ["issue", task.issueKey],
          ["repo", task.repoKey],
          ["state", task.state],
          ["base", task.base],
          ["branch", task.branch],
          ["worktree", task.worktreePath],
        ]),
      );
    });
};
