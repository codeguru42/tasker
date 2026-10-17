import { CommanderError } from "commander";
import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { executeTask } from "../tasks/execute.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const execute: RegisterCommand = (program, io) => {
  program
    .command("execute")
    .description(
      "Carry out the pinned plan revision of a task in approved in the execute session of the assistant, one turn for each todo, and record the state of each todo: the task goes through executing to executed",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      await executeIssue(io, config, issue, { repo: options.repo });
    });
};

// The steps and the output of tasker execute. tasker retry and tasker resume run them too.
export async function executeIssue(io: Io, config: Config, issue: string, options: { repo?: string }): Promise<void> {
  const { key, result } = await orFailAsync(io, () =>
    withIssueTaskAsync(io, config, issue, { repo: options.repo }, async (store, found, ref) => ({
      key: found.issueKey,
      result: await executeTask(store, { config, ref, taskId: found.id, env: process.env, io }),
    })),
  );
  if ("exitCode" in result) {
    throw new CommanderError(result.exitCode, "tasker.execute", "the execute run did not succeed");
  }
  io.stdout(`executed ${key} at revision v${result.version}\n`);
  io.stdout(`todos: ${result.todosDone} of ${result.todosTotal} done\n`);
  if (result.fixTurnDone) io.stdout("fix turn: done\n");
  io.stdout(`denials: ${result.denials}\n`);
  io.stdout(`transcript: ${result.transcriptPath}\n`);
}
