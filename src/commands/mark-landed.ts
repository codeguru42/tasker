import type { RegisterCommand } from "../cli.js";
import { markLandedTask } from "../tasks/mark-landed.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  orFailAsync,
  REPO_OPTION_DESCRIPTION,
  withIssueTaskAsync,
} from "./shared.js";

export const markLanded: RegisterCommand = (program, io) => {
  program
    .command("mark-landed")
    .description(
      "Declare that work in accepted, pushed or in_peer_review landed. This command makes no Git or forge calls",
    )
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .action(async (issue: string, options: { repo?: string }) => {
      const config = loadConfigOrFail(io);
      const marked = await orFailAsync(io, () =>
        withIssueTaskAsync(io, config, issue, { repo: options.repo }, (store, found, ref) =>
          markLandedTask(store, { ref, taskId: found.id }),
        ),
      );
      io.stdout(`marked ${marked.issueKey} landed\n`);
    });
};
