import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { reopenTask } from "../tasks/reopen.js";
import { runPlanCommand } from "./plan-revision.js";
import { ISSUE_ARGUMENT_DESCRIPTION, loadConfigOrFail, REPO_LOCK_WAIT_MS, REPO_OPTION_DESCRIPTION } from "./shared.js";

export const reopen: RegisterCommand = (program, io) => {
  program
    .command("reopen")
    .description(
      "Resync accepted, pushed, or peer-reviewed work to its stored base, then continue the recorded plan session with feedback and record a complete new plan revision for review",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .argument("<feedback>", "The reason to reopen the work and the changes needed in the new plan")
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, feedback: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      await reopenIssue(io, config, issue, options, feedback);
    });
};

// The reopen run and its output. Resume uses this after it restores any pending reopen resync.
export async function reopenIssue(
  io: Io,
  config: Config,
  issue: string,
  options: { repo?: string },
  feedback: string,
): Promise<void> {
  await runPlanCommand(io, config, issue, options, {
    command: "reopen",
    verb: "reopened",
    state: "awaiting_plan_review",
    run: (store, ref, taskId) =>
      reopenTask(store, {
        config,
        ref,
        taskId,
        feedback,
        env: process.env,
        io,
        repoLockWaitMs: REPO_LOCK_WAIT_MS,
      }),
  });
}
