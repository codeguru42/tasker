import { readFileSync } from "node:fs";
import type { Io, RegisterCommand } from "../cli.js";
import { errnoCode } from "../errno.js";
import { bootstrapLogPath } from "../phases/bootstrap.js";
import { taskLogsDir } from "../store/layout.js";
import type { Task } from "../store/store.js";
import { fail, loadConfigOrFail, withIssueTask } from "./shared.js";

// The text of the bootstrap log of task. A read error stops the command with exit code 1.
function readBootstrapLog(io: Io, dataRoot: string, task: Task): string {
  try {
    return readFileSync(bootstrapLogPath(taskLogsDir(dataRoot, task)), "utf8");
  } catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT") fail(io, `no bootstrap log for ${task.issueKey}`);
    fail(io, `cannot read the bootstrap log for ${task.issueKey}: ${code}`);
  }
}

export const showBootstrap: RegisterCommand = (program, io) => {
  program
    .command("show-bootstrap")
    .description("Print the bootstrap log of the task of an issue: the active task, else the newest one")
    .argument("<issue>", "The issue key of the task")
    .option("--repo <key>", "Use the repo with this key when two repos share the project of the issue")
    .action((issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      io.stdout(
        withIssueTask(io, config, issue, { repo: options.repo }, (_store, task) =>
          readBootstrapLog(io, config.dataRoot, task),
        ),
      );
    });
};
