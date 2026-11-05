import type { Io, RegisterCommand } from "../cli.js";
import type { Config } from "../config/schema.js";
import { reopenTask } from "../tasks/reopen.js";
import { reportPlanRun } from "./plan-revision.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_LOCK_WAIT_MS,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const reopen: RegisterCommand = (program, io) => {
  program
    .command("reopen")
    .description(
      "Resync accepted or pushed work to its stored base, then continue the recorded plan session with feedback and record a complete new plan revision for review",
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
  const completed = await orFailAsync(io, () =>
    withIssueTaskAsync(io, config, issue, { repo: options.repo }, async (store, found, ref) => ({
      key: found.issueKey,
      taskId: found.id,
      result: await reopenTask(store, {
        config,
        ref,
        taskId: found.id,
        feedback,
        env: process.env,
        io,
        repoLockWaitMs: REPO_LOCK_WAIT_MS,
      }),
    })),
  );
  await reportPlanRun(io, config, {
    command: "reopen",
    verb: "reopened",
    taskId: completed.taskId,
    result: completed.result,
    key: completed.key,
    state: "awaiting_plan_review",
  });
}
