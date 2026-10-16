import type { Io, RegisterCommand } from "../cli.js";
import { dismissReviewTask } from "../tasks/dismiss-review.js";
import {
  fail,
  ISSUE_ARGUMENT_DESCRIPTION,
  isWholeNumberText,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

// The positions that --finding names, as the text that the user typed after the trim, or undefined without the option. The
// text keeps a very large number exact. The format check refuses a leading zero, so two items name the same position only
// when their texts are the same. It stops the command with exit code 1 when the option is given more than once, when an item
// is not a whole number of 1 or more, or when a position appears twice in one value. It reports each problem on its own
// line, in one run. Spaces around an item are permitted.
function findingPositionsOrFail(io: Io, values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  const lines: string[] = [];
  if (values.length > 1) {
    lines.push("--finding given more than once; give all positions in one list, for example --finding 1,3");
  }
  const lists = values.map((value) => value.split(",").map((item) => item.trim()));
  for (const [index, items] of lists.entries()) {
    if (!items.every(isWholeNumberText)) {
      lines.push(`--finding must be a list of whole numbers of 1 or more, separated by commas: ${values[index]}`);
      continue;
    }
    const repeated = items.filter((item, position) => items.indexOf(item) !== position);
    lines.push(...[...new Set(repeated)].map((item) => `--finding names ${item} more than once`));
  }
  if (lines.length > 0) fail(io, lines.join("\n"));
  return lists[0];
}

export const dismissReview: RegisterCommand = (program, io) => {
  program
    .command("dismiss-review")
    .description(
      "Dismiss the open findings of the latest review of a task in reviewed, all of them or the ones that --finding names, with a reason that the next review reads: the task goes back to awaiting_work_review when no finding is open",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .argument("<reason>", "Why you dismiss the findings, quoted as one argument. The next review reads it")
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option(
      "--finding <ids>",
      "Dismiss only the findings at these positions, as one list separated by commas, for example 1,3. Give the option one time. The default is every open finding",
      (value: string, previous: string[] | undefined) => [...(previous ?? []), value],
    )
    .action(async (issue: string, reason: string, options: { repo?: string; finding?: string[] }) => {
      const positions = findingPositionsOrFail(io, options.finding);
      const config = loadConfigOrFail(io);
      const dismissed = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
          dismissReviewTask(store, { ref, taskId: found.id, reason, positions }),
        ),
      );
      const second =
        dismissed.open.length === 0
          ? "no open findings; the task is in awaiting_work_review"
          : `open findings: ${dismissed.open.join(", ")}`;
      io.stdout(
        `dismissed findings ${dismissed.positions.join(", ")} of review ${dismissed.number} of ${dismissed.issueKey}\n${second}\n`,
      );
    });
};
