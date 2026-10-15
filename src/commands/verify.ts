import { CommanderError } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { verifyTask } from "../tasks/verify.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const verify: RegisterCommand = (program, io) => {
  program
    .command("verify")
    .description(
      "Run the verify commands of the repo in the worktree of a task in executed and record the run: the task goes through verifying to awaiting_work_review, or to failed",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      await verifyIssue(io, config, issue, { repo: options.repo });
    });
};

// The steps and the output of tasker verify. tasker retry runs them too.
export async function verifyIssue(
  io: Io,
  config: Config,
  issue: string,
  options: { repo?: string },
): Promise<void> {
  const { key, result } = await orFailAsync(io, () =>
    withIssueTaskAsync(io, config, issue, { repo: options.repo }, async (store, found, ref) => ({
      key: found.issueKey,
      result: await verifyTask(store, { config, ref, taskId: found.id, env: process.env, io }),
    })),
  );
  if ("exitCode" in result) {
    throw new CommanderError(result.exitCode, "tasker.verify", "the verify run did not succeed");
  }
  io.stdout(`verified ${key}: run ${result.number}\n`);
  io.stdout(`commands: ${result.commands}\n`);
  io.stdout(`logs: ${result.logsDir}\n`);
}
