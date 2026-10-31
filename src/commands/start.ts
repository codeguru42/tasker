import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
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
    .option("--reclaim", "Start the task also when the issue already has the in-progress marker on the tracker")
    .action(async (issue: string, options: { repo?: string; base?: string; reclaim?: boolean }) => {
      const config = loadConfigOrFail(io);
      await startIssue(io, config, issue, { repo: options.repo, base: options.base, reclaim: options.reclaim });
    });
};

// The steps and the output of tasker start. tasker retry runs them too.
export async function startIssue(
  io: Io,
  config: Config,
  issue: string,
  options: { repo?: string; base?: string; reclaim?: boolean },
): Promise<void> {
  const ref = resolveIssueKeyOrFail(io, issue, config, { repo: options.repo });
  // The lines of the tracker writes come after the fields, so they wait in a buffer. The warnings go to stderr at once.
  const trackerLines: string[] = [];
  const ask = () =>
    io.prompt === undefined
      ? Promise.reject(
          new Error(
            `no base branch for ${ref.repoKey}: pass --base <branch> to tasker start, or set repos.${ref.repoKey}.defaultBaseBranch`,
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
          reclaim: options.reclaim === true,
          env: process.env,
          repoLockWaitMs: REPO_LOCK_WAIT_MS,
          ask,
          note: (line) => io.stderr(`${line}\n`),
          trackerIo: { stdout: (line) => trackerLines.push(line), stderr: io.stderr },
        }),
      ),
    // The bootstrap error comes first, then the tail of the log.
    (error) =>
      error instanceof BootstrapFailedError ? `${error.message}\n${error.tail.trimEnd()}` : errorMessage(error),
  );
  const { task } = outcome;
  const sourceField: [string, string][] = outcome.started ? [["base source", outcome.baseSource]] : [];
  if (!outcome.started) io.stdout("task already started\n");
  io.stdout(
    formatFields([
      ["issue", task.issueKey],
      ["repo", task.repoKey],
      ["state", task.state],
      ["base", task.base],
      ...sourceField,
      ["branch", task.branch],
      ["worktree", task.worktreePath],
    ]),
  );
  trackerLines.forEach((line) => io.stdout(line));
}
