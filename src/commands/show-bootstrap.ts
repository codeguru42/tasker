import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Io, RegisterCommand } from "../cli.js";
import { bootstrapLogPath } from "../phases/bootstrap.js";
import { taskArtifactsDir } from "../store/layout.js";
import type { Task } from "../store/store.js";
import { fail, loadConfigOrFail, withIssueTask } from "./shared.js";

// The path of the bootstrap log of the attempt of task.
export function taskBootstrapLogPath(dataRoot: string, task: Pick<Task, "issueKey" | "attempt">): string {
  return bootstrapLogPath(join(taskArtifactsDir(dataRoot, task), "logs"));
}

// The text of the bootstrap log of task. A read error stops the command with exit code 1.
function readBootstrapLog(io: Io, dataRoot: string, task: Task): string {
  try {
    return readFileSync(taskBootstrapLogPath(dataRoot, task), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
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
