import type { RegisterCommand } from "../cli.js";
import { formatQuestions, planHeader, planRevisionOrFail, VERSION_OPTION_DESCRIPTION } from "./plan-revision.js";
import {
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  REPO_OPTION_DESCRIPTION,
  wholeNumberOptionsOrFail,
  withIssueTask,
} from "./shared.js";

export const showQuestions: RegisterCommand = (program, io) => {
  program
    .command("show-questions")
    .description("Print the questions of one plan revision of the task of an issue, each with its state")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option("--version <N>", VERSION_OPTION_DESCRIPTION)
    .action((issue: string, options: { repo?: string; version?: string }) => {
      wholeNumberOptionsOrFail(io, { "--version": options.version });
      const config = loadConfigOrFail(io);
      io.stdout(
        withIssueTask(io, config, issue, { repo: options.repo }, (store, task) => {
          const revision = planRevisionOrFail(io, store, task, options.version);
          const header = planHeader(task, revision);
          const states = store.planQuestions(task.id, revision.version);
          if (states.length === 0) return `${header} has no questions\n`;
          return `${header}\n${formatQuestions(states)}`;
        }),
      );
    });
};
