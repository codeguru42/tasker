import type { RegisterCommand } from "../cli.js";
import { approveTask, type Approved } from "../tasks/approve.js";
import { indented } from "./plan-revision.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  warnOverlaps,
  withIssueTaskAsync,
} from "./shared.js";

// The last lines of the overlap warning of tasker approve: the warning does not stop the approval, and the second
// line names the command that takes the approval back.
function approveOverlapLastLines(issueKey: string): string {
  return `tasker approves the plan anyway.\nTo take the approval back, run: tasker unapprove ${issueKey}`;
}

function approvalText(approved: Approved): string {
  const head = `approved ${approved.issueKey} at revision v${approved.version}\n`;
  const count = approved.openQuestions.length;
  if (count === 0) return `${head}no open questions\n`;
  const lines = approved.openQuestions.map(
    ({ id, question }) => `${indented("  ", `${id}: ${question}`)}\n`,
  );
  return `${head}${count === 1 ? "1 open question:" : `${count} open questions:`}\n${lines.join("")}`;
}

export const approve: RegisterCommand = (program, io) => {
  program
    .command("approve")
    .description(
      "Approve the newest plan revision of a task in awaiting_plan_review: the task goes to approved. Open questions do not stop the approval, and the command lists them",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const approved = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
          approveTask(store, {
            ref,
            taskId: found.id,
            warnOverlaps: (files) =>
              warnOverlaps(io, config, {
                taskId: found.id,
                files,
                env: process.env,
                lastLine: approveOverlapLastLines(found.issueKey),
              }),
          }),
        ),
      );
      io.stdout(approvalText(approved));
    });
};
