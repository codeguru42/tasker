import type { RegisterCommand } from "../cli.js";
import { errorMessage } from "../error-message.js";
import { BootstrapFailedError, startTask } from "../tasks/start.js";
import {
  fail,
  formatFields,
  loadConfigOrFail,
  REPO_LOCK_WAIT_MS,
  resolveIssueKeyOrFail,
  withStoreAsync,
} from "./shared.js";

export const start: RegisterCommand = (program, io) => {
  program
    .command("start")
    .description(
      "Make a task for an issue and take it to workspace_ready: read the issue, make the clone, resolve the base, make the worktree and run bootstrap",
    )
    .argument("<issue>", "The issue key of the task")
    .option("--repo <key>", "Use the repo with this key when two repos share the project of the issue")
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
      let outcome;
      try {
        outcome = await withStoreAsync(config, (store) =>
          startTask(store, {
            config,
            ref,
            base: options.base,
            env: process.env,
            repoLockWaitMs: REPO_LOCK_WAIT_MS,
            ask,
            note: (line) => io.stderr(`${line}\n`),
          }),
        );
      } catch (error) {
        // The bootstrap error comes first, then the tail of the log.
        if (error instanceof BootstrapFailedError) fail(io, `${error.message}\n${error.tail.trimEnd()}`);
        fail(io, errorMessage(error));
      }
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
