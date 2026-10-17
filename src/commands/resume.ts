import type { RegisterCommand } from "../cli.js";
import { resumeTask } from "../tasks/resume.js";
import { runNextCommand, type NextRun } from "./next-command.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const resume: RegisterCommand = (program, io) => {
  program
    .command("resume")
    .description(
      "Move a task in quota_blocked or interrupted back to the state before the run that stopped, and run the same command again",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      // The move ends here and the store is closed, so the lock is free when the next command takes it.
      const { key, origin, target, next, feedback } = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, async (store, found, ref) => ({
          key: found.issueKey,
          ...(await resumeTask(store, { ref, taskId: found.id })),
        })),
      );
      io.stdout(`resumed ${key}: paused in ${origin}, back in ${target}\n`);
      // A move into refining for the feedback form of review always records its feedback.
      const run: NextRun =
        next === "refine"
          ? { command: next, feedback }
          : next === "review-feedback"
            ? { command: next, feedback: feedback! }
            : { command: next };
      await runNextCommand(io, config, issue, { repo: options.repo }, run);
    });
};
