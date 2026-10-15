import type { RegisterCommand } from "../cli.js";
import { bootstrapLogPath } from "../phases/bootstrap.js";
import { taskLogsDir } from "../store/layout.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  readFileOrFail,
  REPO_OPTION_DESCRIPTION,
  withIssueTask,
} from "./shared.js";

export const showBootstrap: RegisterCommand = (program, io) => {
  program
    .command("show-bootstrap")
    .description("Print the bootstrap log of the task of an issue: the active task, else the newest one")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action((issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      io.stdout(
        withIssueTask(io, config, issue, { repo: options.repo }, (_store, task) =>
          readFileOrFail(io, bootstrapLogPath(taskLogsDir(config.dataRoot, task)), {
            missing: `no bootstrap log for ${task.issueKey}`,
            unreadable: `cannot read the bootstrap log for ${task.issueKey}`,
          }),
        ),
      );
    });
};
