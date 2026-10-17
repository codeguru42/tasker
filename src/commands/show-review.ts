import type { RegisterCommand } from "../cli.js";
import { findingCountText, formatFindings } from "../review/findings-text.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  numberedRowOrFail,
  REPO_OPTION_DESCRIPTION,
  wholeNumberOptionsOrFail,
  withIssueTask,
} from "./shared.js";

export const showReview: RegisterCommand = (program, io) => {
  program
    .command("show-review")
    .description("Print one review of the task of an issue: its findings with their status")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option("--review <N>", "Print this review: a whole number of 1 or more. The default is the newest review")
    .action(async (issue: string, options: { repo?: string; review?: string }) => {
      wholeNumberOptionsOrFail(io, { "--review": options.review });
      const config = loadConfigOrFail(io);
      const text = await withIssueTask(io, config, issue, { repo: options.repo }, (store, task) => {
        const total = store.reviewCount(task.id);
        const review = numberedRowOrFail(io, task.issueKey, {
          name: "review",
          command: "review",
          total,
          number: options.review,
          newest: () => store.latestReview(task.id),
          get: (n) => store.getReview(task.id, n),
        });
        const header = `${task.issueKey} review ${review.number} of ${total}: ${findingCountText(review.findings.length)} (at ${review.revision}, ${review.endedAt})\n`;
        return header + formatFindings(review.findings);
      });
      io.stdout(text);
    });
};
