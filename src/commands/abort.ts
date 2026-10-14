import type { RegisterCommand } from "../cli.js";
import { abortTask } from "../tasks/abort.js";
import { loadConfigOrFail, orFailAsync, REPO_LOCK_WAIT_MS, withIssueTaskAsync } from "./shared.js";

export const abort: RegisterCommand = (program, io) => {
  program
    .command("abort")
    .description("Remove the worktree and the task branch of an active task, and move the task to cancelled")
    .argument("<issue>", "The issue key of the task")
    .option("--repo <key>", "Use the repo with this key when two repos share the project of the issue")
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
